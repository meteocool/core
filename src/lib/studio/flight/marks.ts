/**
 * The storms marked in the view from a flight: a small label floating over
 * each of the strongest ahead, as a flight simulator marks what is worth
 * flying to, faint enough to leave the picture alone.
 *
 * What is marked: the cells the radar network tracks, where it tracks any
 * (they come with a top and a motion), and elsewhere the cores of the
 * storms as the radar's volumes list them, the strongest tile of each few
 * dozen kilometres. Which of them, and where each stands from the eye, is
 * worked out here; where that is on the screen is view.ts's, and drawing
 * them the flight deck's.
 */
import { distanceM, wrap180, bearingDeg, EARTH_RADIUS_M } from "./geo";
import type { StormTile } from "./spawn";

export interface StormMark {
  lon: number;
  lat: number;
  /** Its strongest echo, dBZ. */
  peakDbz: number;
  /** Its top, true metres above the sea; null where nothing says. */
  top: number | null;
  /** Where it is going, degrees, and how fast, m/s; null where it is not tracked. */
  heading: number | null;
  speed: number | null;
  hail: boolean;
  /** Lightning strikes round it in the last few minutes; absent where none were counted. */
  strikes?: number;
}

/** The weakest core worth a mark, dBZ: a shower is not somewhere to fly to. */
export const MARK_DBZ = 42;
/** Cores nearer each other than this are one storm, and one mark, km. */
export const MARK_APART_KM = 28;
/** How many marks the view carries at once, and how far off the furthest is, km. */
export const MARKS_SHOWN = 8;
export const MARK_REACH_KM = 280;

/**
 * The cores of the storms the volumes list: the strongest tile first, and
 * no other within `MARK_APART_KM` of one already taken. The finer tiles
 * where the list has them; a coarse one is forty kilometres of sky.
 */
export function coresOf(tiles: readonly StormTile[]): StormMark[] {
  const fine = tiles.filter((tile) => !tile.coarse);
  const strong = (fine.length ? fine : tiles)
    .filter((tile) => (tile.peakDbz ?? 0) >= MARK_DBZ)
    .sort((a, b) => (b.peakDbz ?? 0) - (a.peakDbz ?? 0));
  const cores: StormMark[] = [];
  for (const tile of strong) {
    if (cores.some((core) => distanceM(core.lon, core.lat, tile.lon, tile.lat) < MARK_APART_KM * 1000)) continue;
    cores.push({ lon: tile.lon, lat: tile.lat, peakDbz: tile.peakDbz ?? 0, top: null, heading: null, speed: null, hail: false });
  }
  return cores;
}

/**
 * The marks for a view: tracked cells, and the volumes' cores where no cell
 * stands, the nearest `MARKS_SHOWN` within reach. Those ahead before those
 * behind: a mark is for somewhere to go.
 */
export function marksNear(
  cells: readonly StormMark[], cores: readonly StormMark[], lon: number, lat: number, heading: number,
): StormMark[] {
  const tracked = cells.filter((cell) => cell.peakDbz >= MARK_DBZ);
  const loose = cores.filter((core) => !tracked.some((cell) => distanceM(cell.lon, cell.lat, core.lon, core.lat) < MARK_APART_KM * 1000));
  return [...tracked, ...loose]
    .map((mark) => ({
      mark,
      km: distanceM(lon, lat, mark.lon, mark.lat) / 1000,
      ahead: Math.abs(wrap180(bearingDeg(lon, lat, mark.lon, mark.lat) - heading)) < 100,
    }))
    .filter(({ km }) => km <= MARK_REACH_KM)
    .sort((a, b) => Number(b.ahead) - Number(a.ahead) || a.km - b.km)
    .slice(0, MARKS_SHOWN)
    .map(({ mark }) => mark);
}

/** The weakest echo that still counts as a storm's top, dBZ: what a forecaster reads an echo top at. */
export const TOP_DBZ = 18;

/**
 * A storm's top, true metres: the highest the radar's field over it still
 * has echo, looked for downwards from as high as storms reach. `echo` reads
 * the field at a height over the storm. Null where there is none to find,
 * which is also where the map holds no volume there yet.
 */
export function echoTop(echo: (altitude: number) => number | null, ceiling = 17_000, step = 500): number | null {
  for (let altitude = ceiling; altitude >= 1000; altitude -= step) {
    const dbz = echo(altitude);
    if (dbz !== null && dbz >= TOP_DBZ) return altitude + step / 2;
  }
  return null;
}

/**
 * How high a mark floats, true metres: clear of its storm's top. Where the
 * top is not known, where a storm that strong usually has it.
 */
export function markAltitude(mark: Pick<StormMark, "top" | "peakDbz">): number {
  const top = mark.top ?? Math.min(13_500, Math.max(7000, 8500 + (mark.peakDbz - 45) * 220));
  return top + 1500;
}

/**
 * Where a place is from another on the flat map the 3D map draws: metres
 * north and east, as that map has them. Its north is stretched as a
 * Mercator's is, which over a few hundred kilometres is a few of them; a
 * mark placed by the true distance would stand beside its storm.
 */
export function flatOffset(fromLon: number, fromLat: number, lon: number, lat: number): [number, number] {
  const rad = Math.PI / 180;
  const y = (degrees: number) => Math.log(Math.tan(Math.PI / 4 + (degrees * rad) / 2));
  const scale = EARTH_RADIUS_M * Math.cos(fromLat * rad);
  return [(y(lat) - y(fromLat)) * scale, wrap180(lon - fromLon) * rad * scale];
}
