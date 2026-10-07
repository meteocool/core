/**
 * The 3D map's storms at an earlier scan, found in the bucket by key.
 *
 * `/cells/volumes` lists the newest scan's volumes and nothing older. Each
 * one stays in the bucket for about a day, though, under a key that says
 * when and where -- worker-analysis's `_key`,
 * `volumes/<scan>/<network>-<tile>.mcvx` -- so an older scan's storms can be
 * found by asking for tiles under an older scan, with no list of them.
 *
 * Asked tile by tile, most answers would be misses. So the scan's coarse
 * zoom-9 tiles are asked first: a run builds one over every tile it built,
 * so there is one wherever anything is. Their 1 km voxels say which of their
 * quarters hold echo, and the fine tiles are asked only there, and only where
 * the map would draw them: a quarter's zoom-10 tile, or its four zoom-11
 * tiles where it is a core's. Checked against the demo's 21 coarse tiles of
 * 2026-10-05 22:10: no quarter whose column maximum stayed under 26 dBZ had
 * a tile, and every one over 29 had.
 *
 * The coarse tiles are asked where a newer scan had storms and around them,
 * so the search follows a storm upwind to where it was, and then over the
 * rest of the screen, nearest its middle first, for storms that have died
 * since. What was asked is remembered, found or not and without the voxels,
 * so going back to a scan, or moving the camera over it, asks only what is new.
 *
 * One scan at a time, the one the reader picks: finding one is a few dozen
 * requests, too many to find a whole hour's worth for a playback.
 */
import type { RadarVolume } from "../api";
import type { Cutaway } from "./cellCutaway";
import type { Scan } from "./scans";
import { tileCode } from "./volumeBox";
import { COARSE_ZOOM, tileAt } from "./volumeLevels";

/** Between two scans of a network's composite. */
export const SCAN_SECONDS = 300;

/**
 * How far back the picker reaches, in scans: two hours, as far as the flat
 * map's radar grid goes (`RadarCapability.regenerateGridConfig`), so each one
 * has its own radar to drape under it. The volumes are kept about a day.
 */
export const HISTORY_SCANS = 24;

/** The earlier scans offered, newest first: a scan apart, back from the newest. */
export function earlierScans(newest: Scan, count = HISTORY_SCANS): Scan[] {
  return Array.from({ length: count }, (_unused, i) => newest - (i + 1) * SCAN_SECONDS);
}

/**
 * A network's scan nearest a picked one, on that network's own clock: whole
 * scans from one it is known to have had. Each network's runs land on a
 * clock of their own -- France's at :29 and :34 -- and its volumes are filed
 * under its own scans. Forward as well as back, for a network known only
 * from an older list, which has had nothing to list since.
 */
export function scanOnClock(known: Scan, picked: Scan): Scan {
  return known + Math.round((picked - known) / SCAN_SECONDS) * SCAN_SECONDS;
}

/** A scan as the bucket's keys spell it: `20261005T221000`, UTC. */
export function scanStamp(scan: Scan): string {
  return new Date(scan * 1000).toISOString().slice(0, 19).replace(/[-:]/g, "");
}

/**
 * Where the worker files the volumes, as the API's own example of a path
 * spells it (`CellVolume.path`): for `pathAt` when no list has named one
 * yet -- a quiet hour, with the storms an hour ago.
 */
export const FALLBACK_TEMPLATE = "meteoradar/volumes/20260922T011500/de-T00.mcvx";

/**
 * Where a tile's volume would be at `scan`, named after a listed volume's
 * path: the same bucket and folder, another scan and tile. Null for a path
 * that is not filed that way.
 */
export function pathAt(listed: string, scan: Scan, network: string, code: string): string | null {
  const match = /^(.*\/)\d{8}T\d{6}\/[^/]+\.mcvx$/.exec(listed);
  return match ? `${match[1]}${scanStamp(scan)}/${network}-${code}.mcvx` : null;
}

/** The reflectivity a run seeds its storms at (`volume_seed_dbz`): a quarter without it has no tile. */
const SEED_DBZ = 25;

/** How many of a coarse tile's 1 km columns have to reach it before a quarter is asked for its tile. */
const MIN_QUARTER_COLUMNS = 2;

/**
 * `volume_core_dbz`: a tile whose peak reaches it is built as its four
 * zoom-11 tiles instead. A coarse voxel is a kilometre of the storm, so its
 * peak is lower than the tile's, and a quarter below this can still be a
 * core's; those are asked as a zoom-10 tile first and as zoom-11 tiles after.
 */
const CORE_DBZ = 50;

/** One zoom-10 quarter of a coarse tile, and the echo the coarse tile holds in it. */
export interface Quarter {
  tile: [number, number, number];
  /** The strongest measured echo in it, dBZ, column maximum. */
  peak: number;
  /** How many of its columns reach `SEED_DBZ`. */
  columns: number;
}

/**
 * The four zoom-10 tiles in a coarse tile, with the echo over each.
 *
 * The coarse tile's own ground only, not its apron; its rows run south to
 * north, and the tiles' rows north to south.
 */
export function quarters(coarse: Pick<Cutaway, "header" | "voxels">): Quarter[] {
  const { header, voxels } = coarse;
  const tile = header.tile;
  if (!tile) return [];
  const { nx, ny, nz } = header;
  const [ax, ay] = header.apron ?? [0, 0, 0];
  const across = nx - 2 * ax;
  const up = ny - 2 * ay;
  const strongest = new Int16Array(across * up).fill(-1);
  for (let z = 0; z < nz; z += 1) {
    for (let row = 0; row < up; row += 1) {
      for (let column = 0; column < across; column += 1) {
        const at = ((z * ny + row + ay) * nx + column + ax) * 2;
        // No beam there, whatever the reflectivity byte says.
        if (voxels[at + 1] === 0) continue;
        const cell = row * across + column;
        if (voxels[at] > strongest[cell]) strongest[cell] = voxels[at];
      }
    }
  }
  const seed = (SEED_DBZ - header.dbz_floor) * header.dbz_scale;
  const [, x, y] = tile;
  const found: Quarter[] = [];
  for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    // The northern quarters, qy = 0, are the upper rows.
    const rows = qy === 0 ? [Math.floor(up / 2), up] : [0, Math.floor(up / 2)];
    const columns = qx === 0 ? [0, Math.floor(across / 2)] : [Math.floor(across / 2), across];
    let peak = -1;
    let count = 0;
    for (let row = rows[0]; row < rows[1]; row += 1) {
      for (let column = columns[0]; column < columns[1]; column += 1) {
        const byte = strongest[row * across + column];
        if (byte > peak) peak = byte;
        if (byte >= seed) count += 1;
      }
    }
    found.push({
      tile: [COARSE_ZOOM + 1, 2 * x + qx, 2 * y + qy],
      peak: peak < 0 ? -Infinity : peak / header.dbz_scale + header.dbz_floor,
      columns: count,
    });
  }
  return found;
}

/**
 * The tiles to ask for over one quarter, as two tries: the second only if
 * the first found nothing. Nothing at all where the coarse tile has no storm.
 */
export function tilesToAsk(quarter: Quarter): [Array<[number, number, number]>, Array<[number, number, number]>] {
  if (quarter.columns < MIN_QUARTER_COLUMNS) return [[], []];
  const [z, x, y] = quarter.tile;
  const cores: Array<[number, number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]]
    .map(([dx, dy]) => [z + 1, 2 * x + dx, 2 * y + dy]);
  return quarter.peak >= CORE_DBZ ? [cores, []] : [[quarter.tile], cores];
}

/**
 * The strongest echo a volume measured over its own ground, dBZ, as the
 * list's `peak_dbz` has it; null where no beam reached. A volume found in
 * the bucket has no list entry to say so, and the boxes and the panel are
 * coloured and ranked by it.
 */
export function peakDbz({ header, voxels }: Pick<Cutaway, "header" | "voxels">): number | null {
  const { nx, ny, nz } = header;
  const [ax, ay] = header.apron ?? [0, 0, 0];
  let peak = -1;
  for (let z = 0; z < nz; z += 1) {
    for (let row = ay; row < ny - ay; row += 1) {
      for (let column = ax; column < nx - ax; column += 1) {
        const at = ((z * ny + row) * nx + column) * 2;
        if (voxels[at + 1] !== 0 && voxels[at] > peak) peak = voxels[at];
      }
    }
  }
  return peak < 0 ? null : Math.round((peak / header.dbz_scale + header.dbz_floor) * 10) / 10;
}

/**
 * A volume as the list would have had it, from its own header: for one
 * found in the bucket, or named by a link after its scan left the list.
 * Without the area, which a header does not carry.
 */
export function volumeOf(path: string, cutaway: Cutaway, network?: string): RadarVolume {
  const { header } = cutaway;
  return {
    path,
    code: header.code,
    network: header.network ?? network ?? "de",
    tier: header.tier ?? 2,
    lon: header.lon,
    lat: header.lat,
    reference_time: header.reference_time,
    coverage: header.coverage,
    sites: header.sites,
    scanned_at: header.scanned_at ?? null,
    oldest_scan_at: header.oldest_scan_at ?? null,
    tile: header.tile ?? null,
    coarse: (header.tile?.[0] ?? COARSE_ZOOM + 1) <= COARSE_ZOOM,
    peak_dbz: peakDbz(cutaway),
  };
}

/** A coarse tile's ground, in one network's composite: what a scan is asked around. */
export interface Place {
  network: string;
  x: number;
  y: number;
}

export const placeKey = ({ network, x, y }: Place): string => `${network}/${x}/${y}`;

/** The coarse tile a tile of any zoom lies in, as `x, y`. */
export function coarseOf(tile: readonly number[]): [number, number] {
  const shift = tile[0] - COARSE_ZOOM;
  return [tile[1] >> shift, tile[2] >> shift];
}

/** These places and the eight around each, once each. */
export function around(places: Iterable<Place>): Place[] {
  const found = new Map<string, Place>();
  for (const { network, x, y } of places) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const place = { network, x: x + dx, y: y + dy };
        found.set(placeKey(place), place);
      }
    }
  }
  return [...found.values()];
}

/**
 * The coarse tiles over a stretch of map, west, south, east, north, as
 * `x, y`: no further than `reach` tiles from the one `centre` is in, since
 * a tilted camera's bounds run out to the horizon.
 */
export function coarseTilesIn(
  [west, south, east, north]: readonly number[], centre: { lon: number; lat: number }, reach: number,
): Array<[number, number]> {
  const [cx, cy] = tileAt(centre.lon, centre.lat, COARSE_ZOOM);
  // Rows run north to south.
  const [x0, y0] = tileAt(west, north, COARSE_ZOOM);
  const [x1, y1] = tileAt(east, south, COARSE_ZOOM);
  const found: Array<[number, number]> = [];
  for (let y = Math.max(y0, cy - reach); y <= Math.min(y1, cy + reach); y += 1) {
    for (let x = Math.max(x0, cx - reach); x <= Math.min(x1, cx + reach); x += 1) found.push([x, y]);
  }
  return found;
}

/**
 * Which coarse tiles to ask a scan for, in order: where storms were -- in a
 * newer scan, or already found in this one -- then the tiles around them,
 * then the rest of `view`, each nearest the middle of the screen first.
 * Only those `inView` keeps, and of them at most `count` not `asked` before,
 * `viewCount` of them from the view: the storms are followed first, and the
 * screen's emptier ground is looked over a little at a time. The ones asked
 * before cost nothing, and are kept in the order for their fine tiles.
 */
export function placesToAsk({ storms, view, inView, distance, count, viewCount = count, asked = () => false }: {
  storms: Iterable<Place>;
  view: Iterable<Place>;
  inView: (place: Place) => boolean;
  distance: (place: Place) => number;
  count: number;
  viewCount?: number;
  asked?: (place: Place) => boolean;
}): Place[] {
  const known = [...storms];
  const seen = new Set<string>();
  const ordered: Place[] = [];
  let left = count;
  for (const [group, most] of [[known, count], [around(known), count], [[...view], viewCount]] as const) {
    const fresh: Array<{ place: Place; far: number }> = [];
    for (const place of group) {
      const key = placeKey(place);
      if (seen.has(key) || !inView(place)) continue;
      seen.add(key);
      fresh.push({ place, far: distance(place) });
    }
    let room = Math.min(left, most);
    for (const { place } of fresh.sort((a, b) => a.far - b.far)) {
      if (asked(place)) ordered.push(place);
      else if (room > 0) {
        ordered.push(place);
        room -= 1;
        left -= 1;
      }
    }
  }
  return ordered;
}

/** A coarse tile found under an earlier scan. */
export interface Found {
  volume: RadarVolume;
  /** Its quarters with a storm in them, which its fine tiles are asked by. */
  stormy: Quarter[];
  /** Too faint to draw (see `ScanAsk.faint`): kept for its quarters, left off the list. */
  faint: boolean;
}

/**
 * What is known of one earlier scan: every tile asked for, found or not.
 * No voxels, so several scans of it cost next to nothing to keep.
 */
export interface ScanFinds {
  /** Each coarse place asked, by `placeKey`: its tile, or null where there was none. */
  coarse: Map<string, Found | null>;
  /** Each coarse place whose fine tiles were asked, by `placeKey`: the ones found, bar the faint. */
  fine: Map<string, RadarVolume[]>;
  /**
   * Asks that failed other than by the tile not being there. Those are not
   * remembered, so they are asked again; and a scan that found nothing can
   * be told from one that could not look.
   */
  failed: number;
  /** Why the latest of those failed, for reporting a scan that could not look. */
  lastError?: unknown;
}

export const noFinds = (): ScanFinds => ({ coarse: new Map(), fine: new Map(), failed: 0 });

/** Every volume found under a scan worth drawing: the list it would have had, coarse tiles and fine. */
export function listOf(finds: ScanFinds): RadarVolume[] {
  const coarse = [...finds.coarse.values()].flatMap((found) => (found && !found.faint ? [found.volume] : []));
  return [...coarse, ...[...finds.fine.values()].flat()];
}

/** How to ask one scan for its storms. */
export interface ScanAsk {
  /** Each network's own scan, the one asked for; see `scanOnClock`. */
  scanOf(network: string): Scan;
  /** A listed volume's path, which every other is named after; see `pathAt`. */
  template: string;
  /** The coarse tiles to ask for, the ones to draw first first; see `placesToAsk`. */
  places: Place[];
  /**
   * Whether a coarse tile found is to be drawn as the tiles in it, so that
   * they are asked for too. Asked in the places' order, once every coarse
   * tile is in, with the quarters that hold a storm: so it can keep count of
   * what it has let through, and leave the rest coarse.
   */
  fine(place: Place, stormy: Quarter[]): boolean;
  /** One volume; null when it is not there, thrown when it would not load. */
  fetch(path: string): Promise<Cutaway | null>;
  /**
   * Whether a volume is too faint to draw, as the map judges the listed
   * ones. Left off the list, as the map leaves those off the screen, so a
   * scan of nothing but wisps is a scan with nothing to show.
   */
  faint?(cutaway: Cutaway): boolean;
  /** Each volume worth drawing as it lands, voxels and all, for the caller: `ScanFinds` keeps only what it is. */
  landed?(volume: RadarVolume, cutaway: Cutaway): void;
  /** How far the asking has got, 0 to 1. */
  progress?(share: number): void;
}

/** How much of the progress the coarse tiles are, when fine ones are asked after them. */
const COARSE_SHARE = 0.6;

/**
 * Ask a scan for what `finds` does not know yet, and add it there: the
 * coarse tiles over the places, then the fine tiles in those drawn fine.
 */
export async function askScan(ask: ScanAsk, finds: ScanFinds): Promise<void> {
  type Answer = { volume: RadarVolume; cutaway: Cutaway; faint: boolean } | "none" | "failed";
  const tileAt = async (place: Place, tile: [number, number, number]): Promise<Answer> => {
    const path = pathAt(ask.template, ask.scanOf(place.network), place.network, tileCode(...tile));
    if (!path) return "none";
    let cutaway: Cutaway | null;
    try {
      cutaway = await ask.fetch(path);
    } catch (error) {
      finds.failed += 1;
      finds.lastError = error;
      return "failed";
    }
    if (!cutaway) return "none";
    const volume = volumeOf(path, cutaway, place.network);
    const faint = ask.faint?.(cutaway) ?? false;
    if (!faint) ask.landed?.(volume, cutaway);
    return { volume, cutaway, faint };
  };
  const counter = (from: number, share: number, total: number) => {
    let done = 0;
    return () => {
      done += 1;
      ask.progress?.(from + (share * done) / Math.max(total, 1));
    };
  };

  const coarse = ask.places.filter((place) => !finds.coarse.has(placeKey(place)));
  const stormyOf = (place: Place) => finds.coarse.get(placeKey(place))?.stormy ?? [];
  // Which of the coarse tiles already known want their fine tiles is only
  // known once the new ones are in; the share is a guess until then.
  let tick = counter(0, COARSE_SHARE, coarse.length);
  await Promise.all(coarse.map(async (place) => {
    const answer = await tileAt(place, [COARSE_ZOOM, place.x, place.y]);
    if (answer === "none") finds.coarse.set(placeKey(place), null);
    else if (answer !== "failed") {
      const stormy = quarters(answer.cutaway).filter((quarter) => tilesToAsk(quarter)[0].length > 0);
      finds.coarse.set(placeKey(place), { volume: answer.volume, stormy, faint: answer.faint });
    }
    tick();
  }));

  const asked = ask.places.filter((place) => (
    !finds.fine.has(placeKey(place)) && stormyOf(place).length > 0 && ask.fine(place, stormyOf(place))
  ));
  tick = counter(coarse.length ? COARSE_SHARE : 0, coarse.length ? 1 - COARSE_SHARE : 1, asked.length);
  await Promise.all(asked.map(async (place) => {
    let failed = false;
    const tryTiles = async (tiles: Array<[number, number, number]>) => {
      const answers = await Promise.all(tiles.map((tile) => tileAt(place, tile)));
      if (answers.includes("failed")) failed = true;
      return answers.flatMap((answer) => (typeof answer === "object" ? [answer] : []));
    };
    const tiles = await Promise.all(stormyOf(place).map(async (quarter) => {
      const [first, second] = tilesToAsk(quarter);
      const tried = await tryTiles(first);
      return tried.length || !second.length || failed ? tried : tryTiles(second);
    }));
    // Not remembered when a tile would not load: the coarse tile stands in
    // for them meanwhile, and the next look asks again.
    if (!failed) finds.fine.set(placeKey(place), tiles.flat().filter(({ faint }) => !faint).map(({ volume }) => volume));
    tick();
  }));
  ask.progress?.(1);
}

/** At most this many tasks at once, the rest queued in order. */
export function limited(count: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (running >= count) return;
    const start = queue.shift();
    if (start) start();
  };
  return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      running += 1;
      task().then(resolve, reject).finally(() => {
        running -= 1;
        next();
      });
    });
    next();
  });
}
