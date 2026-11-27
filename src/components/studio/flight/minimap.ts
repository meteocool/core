/**
 * The map of a flight seen from outside (FlightMinimap.svelte): where things
 * stand on it, and drawing it.
 *
 * A round map with the aircraft in its middle, as far to its rim as the
 * range chosen. Heading up, the way the navigation display in the cockpit
 * is, so what is ahead of the aircraft is up; or north up, with the aircraft
 * turning on it. On it, the radar's own picture as the map drapes it on the
 * ground, in the same tiles; the storms the view marks; the one flown at,
 * and the line to it; lightning; and the way the aircraft has come.
 *
 * Flat, as the 3D map is flat (`flatOffset`): what is on the ground there is
 * in the same place here, and a radar tile is a square.
 */
import { destination, EARTH_RADIUS_M, wrap180 } from "../../../lib/studio/flight/geo";
import type { FlightCut } from "../../../lib/studio/director";
import { flatOffset } from "../../../lib/studio/flight/marks";
import type { StormMark } from "../../../lib/studio/flight/marks";
import type { Telemetry } from "../../../lib/studio/flight/pilot";
import { MAGENTA, radarColour, stormPicture, text, tileKm } from "./instruments";

const NM = 1852;
const RADIANS = Math.PI / 180;

/** How far the map reaches from the aircraft to its rim, NM, as a click steps through them: 20 to 160 across. */
export const RANGES_NM = [10, 20, 40, 80] as const;

/** The radar's tiles are drawn no finer and no coarser than these zooms: what its sources have. */
const TILE_ZOOMS: [number, number] = [3, 8];
/** A radar tile's side, pixels. */
const TILE_PX = 512;

/** What the map is of: where its middle is, which way is up, and how far its rim is in miles and in pixels. */
export interface Chart {
  lon: number;
  lat: number;
  /** The aircraft's heading, degrees. */
  heading: number;
  /** Whether the heading is up; north is, otherwise. */
  headingUp: boolean;
  rangeNm: number;
  /** From the middle to the rim, CSS pixels. */
  radius: number;
}

/** A radar tile: its zoom, column and row, counted from the north-west as a map's tiles are. */
export type Tile = [z: number, x: number, y: number];

/** The direction at the top of the map, degrees clockwise from north. */
export const upOf = (chart: Chart): number => (chart.headingUp ? chart.heading : 0);

/** How many pixels a metre on the ground is. */
export const perMetre = (chart: Chart): number => chart.radius / (chart.rangeNm * NM);

/** Metres east and north of the middle, turned to the map: pixels right and down of it. */
function turned(chart: Chart, east: number, north: number): [number, number] {
  const up = upOf(chart) * RADIANS;
  const scale = perMetre(chart);
  return [(east * Math.cos(up) - north * Math.sin(up)) * scale, -(east * Math.sin(up) + north * Math.cos(up)) * scale];
}

/** Where a place is on the map: pixels right and down of its middle. */
export function place(chart: Chart, lon: number, lat: number): [number, number] {
  const [north, east] = flatOffset(chart.lon, chart.lat, lon, lat);
  return turned(chart, east, north);
}

/** Where something a bearing and a distance (m) from the aircraft is on the map. */
export function placeAt(chart: Chart, bearing: number, metres: number): [number, number] {
  return turned(chart, Math.sin(bearing * RADIANS) * metres, Math.cos(bearing * RADIANS) * metres);
}

/**
 * A point held inside the rim: itself where it is on the map, and on the
 * line to it, `margin` short of the rim, where it is beyond. Whether it was.
 */
export function withinRim(point: readonly [number, number], radius: number, margin = 0): { x: number; y: number; beyond: boolean } {
  const [x, y] = point;
  const away = Math.hypot(x, y);
  const most = radius - margin;
  if (away <= most) return { x, y, beyond: false };
  return { x: (x / away) * most, y: (y / away) * most, beyond: true };
}

/** How far the rings are from the aircraft, NM: half the range, and the range, which is the rim. */
export const ringsOf = (rangeNm: number): [number, number] => [rangeNm / 2, rangeNm];

/** The ground a whole world of tiles would cover at the map's latitude, metres across. */
const worldM = (chart: Chart) => 2 * Math.PI * EARTH_RADIUS_M * Math.cos(chart.lat * RADIANS);

/**
 * The zoom whose radar tiles are about as fine as the map is drawn, at
 * `ratio` screen pixels to a CSS one: finer would be fetched to be thrown
 * away, coarser would show its squares.
 */
export function tileZoom(chart: Chart, ratio = 1): number {
  const zoom = Math.round(Math.log2((worldM(chart) * perMetre(chart) * ratio) / TILE_PX));
  return Math.min(Math.max(zoom, TILE_ZOOMS[0]), TILE_ZOOMS[1]);
}

/** A place as a tile's column and row at a zoom, with the fraction of the way across it. */
function tileAt(lon: number, lat: number, zoom: number): [number, number] {
  const count = 2 ** zoom;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * RADIANS) / 2));
  return [((lon + 180) / 360) * count, ((1 - y / Math.PI) / 2) * count];
}

/** The tiles at a zoom that reach into the map's circle. */
export function tilesOver(chart: Chart, zoom: number): Tile[] {
  const count = 2 ** zoom;
  const [column, row] = tileAt(chart.lon, chart.lat, zoom);
  const reach = (chart.rangeNm * NM * count) / worldM(chart);
  const tiles: Tile[] = [];
  for (let y = Math.max(0, Math.floor(row - reach)); y <= Math.min(count - 1, Math.floor(row + reach)); y += 1) {
    for (let x = Math.floor(column - reach); x <= Math.floor(column + reach); x += 1) {
      // The nearest point of the tile to the middle, against the circle.
      const dx = Math.max(x - column, 0, column - (x + 1));
      const dy = Math.max(y - row, 0, row - (y + 1));
      if (Math.hypot(dx, dy) <= reach) tiles.push([zoom, ((x % count) + count) % count, y]);
    }
  }
  return tiles;
}

/**
 * Where a tile goes on the map before the map is turned: its north-west
 * corner, pixels right and down of the middle with north up, and its side.
 */
export function tileBox(chart: Chart, [zoom, x, y]: Tile): { x: number; y: number; side: number } {
  const count = 2 ** zoom;
  const [column, row] = tileAt(chart.lon, chart.lat, zoom);
  const side = (worldM(chart) / count) * perMetre(chart);
  // The nearer way round the world, for a map across the date line.
  let across = x - column;
  if (across > count / 2) across -= count;
  if (across < -count / 2) across += count;
  return { x: across * side, y: (y - row) * side, side };
}

/**
 * How far the picture has moved since it was drawn as `drawn`, pixels: by
 * the aircraft's going, and by its turning, which at the rim of a map with
 * the heading up is the most. Infinite for another map altogether.
 */
export function shiftSince(chart: Chart, drawn: Chart | null): number {
  if (!drawn || drawn.rangeNm !== chart.rangeNm || drawn.headingUp !== chart.headingUp || drawn.radius !== chart.radius) return Infinity;
  const gone = Math.hypot(...place(chart, drawn.lon, drawn.lat));
  // North up only the aircraft turns, and that is small.
  const arm = chart.headingUp ? chart.radius : AIRCRAFT_PX;
  return Math.max(gone, Math.abs(wrap180(chart.heading - drawn.heading)) * RADIANS * arm);
}

/**
 * The radar's tiles, kept while the map shows them: each asked for once,
 * and let go of once the map has drawn without it and there are more than
 * a few. What a drawing asks for, all at the same `now`, is never let go
 * of by that drawing, however many it is: most of a map's tiles are known
 * to be empty, and cost nothing to keep. `load` fetches one (null for a
 * tile with nothing in it), `free` lets go of one, `arrived` says a tile
 * has come and the map wants drawing again.
 */
export class TileStore<Picture> {
  private readonly held = new Map<string, { picture: Picture | null; state: "loading" | "here" | "failed"; used: number; at: number }>();
  private disposed = false;
  private readonly load: (url: string) => Promise<Picture | null>;
  private readonly free: (picture: Picture) => void;
  private readonly arrived: () => void;
  private readonly most: number;
  private readonly retryMs: number;

  /** Past `most` tiles, those not in use are let go of; one that failed is asked for again after `retryMs`. */
  constructor(
    load: (url: string) => Promise<Picture | null>, free: (picture: Picture) => void, arrived: () => void, most = 24, retryMs = 15_000,
  ) {
    this.load = load;
    this.free = free;
    this.arrived = arrived;
    this.most = most;
    this.retryMs = retryMs;
  }

  /** The tile if it is here, null for one with nothing in it, undefined while it is on its way; asked for if it has not been. */
  get(url: string, now: number): Picture | null | undefined {
    const entry = this.held.get(url);
    if (entry) {
      entry.used = now;
      if (entry.state === "here") return entry.picture;
      if (entry.state === "loading" || now - entry.at < this.retryMs) return undefined;
    }
    const asked = { picture: null as Picture | null, state: "loading" as "loading" | "here" | "failed", used: now, at: now };
    this.held.set(url, asked);
    this.load(url).then((picture) => {
      // Let go of meanwhile: nobody is waiting for it.
      if (this.disposed || this.held.get(url) !== asked) {
        if (picture) this.free(picture);
        return;
      }
      asked.picture = picture;
      asked.state = "here";
      this.arrived();
    }, () => {
      asked.state = "failed";
    });
    this.trim(now);
    return undefined;
  }

  /** The tile if it is here already, in use by this drawing as one got is; never asked for. */
  peek(url: string, now: number): Picture | null | undefined {
    const entry = this.held.get(url);
    if (entry) entry.used = now;
    return entry?.state === "here" ? entry.picture : undefined;
  }

  /** Let go of the longest unused, down to as many as are kept: none of those this drawing uses. */
  private trim(now: number): void {
    if (this.held.size <= this.most) return;
    const unused = [...this.held.entries()].filter(([, entry]) => entry.used < now).sort(([, one], [, other]) => one.used - other.used);
    for (const [url, entry] of unused.slice(0, this.held.size - this.most)) {
      if (entry.picture) this.free(entry.picture);
      this.held.delete(url);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.held.values()) if (entry.picture) this.free(entry.picture);
    this.held.clear();
  }
}

/** A tile's address from its source's template. */
export const tileUrl = (template: string, [z, x, y]: Tile): string => (
  template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y))
);

/** Lightning on the map: where, how much of its time on the map is gone (0 to 1), and whether it reached the ground. */
export interface ChartStrike {
  lon: number;
  lat: number;
  age: number;
  ground: boolean;
}

/** What is drawn on the map. */
export interface ChartContent<Picture = CanvasImageSource> {
  /** The radar's picture, as tiles, the lowest first. */
  radar: Array<{ picture: Picture; tile: Tile }>;
  /** The listed storms, painted as the navigation display paints them where there is no radar picture to draw; null where there is. */
  storms: Telemetry["storms"] | null;
  /** The storms the view marks. */
  cores: readonly StormMark[];
  /** The storm flown at. */
  target: Telemetry["target"];
  /** The storm being looked into. */
  inspected: { lon: number; lat: number } | null;
  /** Where the cut through it stands, while it is cut open: drawn as the 3D view draws it, a line in Studio's accent. */
  cut?: FlightCut | null;
  /** Where the aircraft has been, the oldest first. */
  track: ReadonlyArray<readonly [number, number]>;
  strikes: readonly ChartStrike[];
  /** Other aircraft heard of, each where it is drawn now; none where not said. */
  others?: ReadonlyArray<ChartOther>;
}

/** Another aircraft, as the map needs it. */
export interface ChartOther {
  callsign?: string;
  shown: { lon: number; lat: number; heading: number; opacity: number };
}

/** How many aircraft beyond the rim are marked on it, and how many of those are named. */
const BEYOND_MOST = 12;
const BEYOND_NAMED = 3;

/** An aircraft beyond the rim: where on the rim it is held, and how far away it is, NM. */
export interface OtherBeyond {
  x: number;
  y: number;
  nm: number;
  callsign: string;
}

/**
 * The other aircraft beyond the rim, the nearest first and `most` at most:
 * each is held on the rim, `margin` short of it, on the line to where it is,
 * however far that is.
 */
export function othersBeyond(chart: Chart, others: ReadonlyArray<ChartOther>, margin: number, most = BEYOND_MOST): OtherBeyond[] {
  const beyond: OtherBeyond[] = [];
  const scale = perMetre(chart);
  for (const { shown, callsign } of others) {
    if (shown.opacity <= 0.05) continue;
    const where = place(chart, shown.lon, shown.lat);
    const at = withinRim(where, chart.radius, margin);
    if (!at.beyond) continue;
    beyond.push({ x: at.x, y: at.y, nm: Math.hypot(where[0], where[1]) / scale / NM, callsign: callsign ?? "" });
  }
  beyond.sort((a, b) => a.nm - b.nm);
  return beyond.slice(0, most);
}

const HALO = "rgba(5, 7, 10, 0.85)";
const INK = "#f2f4f7";
/** Studio's accent, which the cut's sheet in the 3D view is drawn in (layers/studioPlanesLayer.ts). */
const CUT_ACCENT = "#ff9e1c";
const RING = "rgba(242, 244, 247, 0.34)";
const STRIKE = "#ffe14a";
/** Other aircraft, as a navigation display draws traffic. */
const OTHER = "#4fd8ff";
/** An aircraft this near the rim, pixels, or beyond it, is marked on the rim. */
const BEYOND_MARGIN = 7;
/** The aircraft on the map, nose to tail, pixels. */
const AIRCRAFT_PX = 22;

/** An airliner from above, nose up, a unit long: half of it, mirrored when drawn. */
const AIRCRAFT: ReadonlyArray<readonly [number, number]> = [
  [0, -0.5], [0.07, -0.36], [0.075, -0.1], [0.5, 0.14], [0.5, 0.22], [0.075, 0.12], [0.06, 0.36], [0.2, 0.46], [0.2, 0.52], [0, 0.47],
];

/** Small print with a dark edge: read over the radar's colours as over the dark. */
function label(context: CanvasRenderingContext2D, value: string, x: number, y: number, colour = INK, size = 10): void {
  context.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = HALO;
  context.lineWidth = 3;
  context.strokeText(value, x, y);
  text(context, value, x, y, { size, colour });
}

/** A diamond, as a storm's mark in the view is one. */
function diamond(context: CanvasRenderingContext2D, x: number, y: number, half: number): void {
  context.beginPath();
  context.moveTo(x, y - half);
  context.lineTo(x + half, y);
  context.lineTo(x, y + half);
  context.lineTo(x - half, y);
  context.closePath();
}

/**
 * Draw the map into a square of `2 * chart.radius`, cleared and scaled to
 * CSS pixels already (instruments.ts `prepare`).
 */
export function drawChart(context: CanvasRenderingContext2D, chart: Chart, content: ChartContent): number {
  const { radius } = chart;
  const up = upOf(chart) * RADIANS;
  const scale = perMetre(chart);
  // A small map, as a phone's is, has room for a smaller aircraft and the one ring's miles.
  const small = radius < 80;
  const aircraft = small ? AIRCRAFT_PX * 0.75 : AIRCRAFT_PX;
  context.save();
  context.translate(radius, radius);
  context.lineCap = "round";
  context.lineJoin = "round";

  // What is of the ground, inside the rim.
  context.save();
  context.beginPath();
  context.arc(0, 0, radius - 1, 0, 2 * Math.PI);
  context.clip();

  // The radar, turned with the map: north up in its own frame.
  context.save();
  context.rotate(-up);
  context.globalAlpha = 0.88;
  for (const { picture, tile } of content.radar) {
    const box = tileBox(chart, tile);
    // A hair over its side: no seam between tiles.
    context.drawImage(picture, box.x, box.y, box.side + 0.5, box.side + 0.5);
  }
  for (const storm of content.storms ? stormPicture(content.storms) : []) {
    const colour = radarColour(storm.peakDbz ?? 0);
    if (!colour) continue;
    const [north, east] = flatOffset(chart.lon, chart.lat, storm.lon, storm.lat);
    const side = tileKm(storm.tile, storm.lat) * 1000 * scale * 1.03 + 0.5;
    if (Math.hypot(north, east) * scale > radius + side) continue;
    context.fillStyle = colour;
    context.fillRect(east * scale - side / 2, -north * scale - side / 2, side, side);
  }
  context.restore();

  // The way come: fainter the longer ago.
  const { track } = content;
  context.lineWidth = 1.5;
  for (let from = 0; from < track.length - 1; from += 8) {
    const to = Math.min(from + 8, track.length - 1);
    context.strokeStyle = `rgba(242, 244, 247, ${(0.12 + 0.5 * (to / (track.length - 1))).toFixed(2)})`;
    context.beginPath();
    for (let i = from; i <= to; i += 1) {
      const [x, y] = place(chart, track[i][0], track[i][1]);
      if (i === from) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    if (to === track.length - 1) context.lineTo(0, 0);
    context.stroke();
  }

  // The inner ring, and how far it is.
  const [inner, outer] = ringsOf(chart.rangeNm);
  context.strokeStyle = RING;
  context.lineWidth = 1;
  context.setLineDash([3, 4]);
  context.beginPath();
  context.arc(0, 0, radius / 2, 0, 2 * Math.PI);
  context.stroke();
  context.setLineDash([]);

  // Lightning: a strike on the ground stays a while, one in the cloud is a glint.
  for (const strike of content.strikes) {
    const [x, y] = place(chart, strike.lon, strike.lat);
    if (Math.hypot(x, y) > radius) continue;
    context.globalAlpha = Math.max(0, 1 - strike.age) ** 0.6;
    if (!strike.ground) {
      context.fillStyle = "#fff";
      context.beginPath();
      context.arc(x, y, 2.5, 0, 2 * Math.PI);
      context.fill();
      continue;
    }
    for (const [colour, width] of [[HALO, 3.5], [STRIKE, 1.5]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x + 1.5, y - 5);
      context.lineTo(x - 2, y + 0.5);
      context.lineTo(x + 2, y - 0.5);
      context.lineTo(x - 1.5, y + 5);
      context.stroke();
    }
  }
  context.globalAlpha = 1;

  // The storms the view marks, each in its strength's colour.
  for (const core of content.cores) {
    const [x, y] = place(chart, core.lon, core.lat);
    if (Math.hypot(x, y) > radius - 4) continue;
    for (const [colour, width] of [[HALO, 3.5], [radarColour(core.peakDbz) ?? INK, 1.5]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      diamond(context, x, y, 4.5);
      context.stroke();
    }
  }
  if (content.inspected) {
    const [x, y] = place(chart, content.inspected.lon, content.inspected.lat);
    context.strokeStyle = "rgba(255, 255, 255, 0.85)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x, y, 9, 0, 2 * Math.PI);
    context.stroke();
  }
  if (content.cut) {
    const { cut } = content;
    const [a, b] = [cut.facingDeg - 90, cut.facingDeg + 90].map((bearing) => {
      const [lon, lat] = destination(cut.lon, cut.lat, bearing, cut.halfKm * 1000);
      return place(chart, lon, lat);
    });
    for (const [colour, width] of [[HALO, 4], [CUT_ACCENT, 2]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.stroke();
    }
  }
  // Other aircraft: small hollow chevrons pointing their way, in cyan, never the own aircraft's white.
  let charted = 0;
  for (const { shown } of content.others ?? []) {
    if (shown.opacity <= 0.05) continue;
    const [x, y] = place(chart, shown.lon, shown.lat);
    if (Math.hypot(x, y) > radius - BEYOND_MARGIN) continue;
    charted += 1;
    context.save();
    context.translate(x, y);
    context.rotate(shown.heading * RADIANS - up);
    context.globalAlpha = Math.min(1, shown.opacity);
    context.beginPath();
    context.moveTo(0, -5);
    context.lineTo(3.8, 4);
    context.lineTo(0, 2);
    context.lineTo(-3.8, 4);
    context.closePath();
    context.lineWidth = 3;
    context.strokeStyle = HALO;
    context.stroke();
    context.lineWidth = 1.4;
    context.strokeStyle = OTHER;
    context.stroke();
    context.restore();
  }
  context.restore();

  // And those beyond the rim, on it: an arrowhead pointing out to each, the nearest few with their callsign and how far.
  const beyond = othersBeyond(chart, content.others ?? [], BEYOND_MARGIN);
  charted += beyond.length;
  beyond.forEach((other, i) => {
    context.save();
    context.translate(other.x, other.y);
    context.rotate(Math.atan2(other.x, -other.y));
    context.beginPath();
    context.moveTo(0, -5);
    context.lineTo(4, 3);
    context.lineTo(-4, 3);
    context.closePath();
    context.lineWidth = 3;
    context.strokeStyle = HALO;
    context.stroke();
    context.fillStyle = OTHER;
    context.fill();
    context.restore();
    if (i < BEYOND_NAMED) {
      const miles = `${Math.round(other.nm)} NM`;
      const said = other.callsign ? `${other.callsign} · ${miles}` : miles;
      // Inwards of its mark, and kept whole inside the round map: across it at that height there is only so much room.
      const y = other.y * 0.78;
      context.font = "600 9px system-ui, -apple-system, sans-serif";
      const room = Math.max(0, Math.sqrt(Math.max(0, radius * radius - y * y)) - context.measureText(said).width / 2 - 5);
      label(context, said, Math.max(-room, Math.min(room, other.x * 0.78)), y, OTHER, 9);
    }
  });

  // The storm flown at, and the line to it: on the rim where it is beyond it.
  const { target } = content;
  let north = radius - 11;
  if (target) {
    const at = withinRim(placeAt(chart, target.bearing, target.distance), radius, 9);
    // North's letter stands further in where the storm's mark is in its place on the rim.
    if (Math.hypot(at.x - Math.sin(-up) * north, at.y + Math.cos(-up) * north) < 15) north -= 15;
    const away = Math.hypot(at.x, at.y);
    if (away > aircraft) {
      context.strokeStyle = MAGENTA;
      context.lineWidth = 1.5;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo((at.x / away) * (aircraft * 0.7), (at.y / away) * (aircraft * 0.7));
      context.lineTo((at.x / away) * (away - 8), (at.y / away) * (away - 8));
      context.stroke();
      context.setLineDash([]);
    }
    for (const [colour, width] of [[HALO, 4], [MAGENTA, 2]] as const) {
      context.strokeStyle = colour;
      context.lineWidth = width;
      diamond(context, at.x, at.y, 6);
      context.stroke();
    }
    if (at.beyond) {
      context.fillStyle = MAGENTA;
      diamond(context, at.x, at.y, 6);
      context.fill();
    }
  }

  // The compass on the rim, turning with the map: a tick each thirty degrees, and north by its letter.
  context.strokeStyle = RING;
  context.lineWidth = 1;
  for (let mark = 30; mark < 360; mark += 30) {
    const angle = mark * RADIANS - up;
    const long = mark % 90 === 0 ? 7 : 4;
    context.beginPath();
    context.moveTo(Math.sin(angle) * (radius - 1), -Math.cos(angle) * (radius - 1));
    context.lineTo(Math.sin(angle) * (radius - 1 - long), -Math.cos(angle) * (radius - 1 - long));
    context.stroke();
  }
  label(context, "N", Math.sin(-up) * north, -Math.cos(-up) * north, INK, 11);

  // How far the rings are, where neither the way ahead nor the way come crosses them.
  const corner = 135 * RADIANS;
  if (!small) label(context, String(inner), Math.sin(corner) * (radius / 2), -Math.cos(corner) * (radius / 2), "#c9d0d8");
  const edge = radius - (small ? 17 : 21);
  label(context, `${outer} NM`, Math.sin(corner) * edge, -Math.cos(corner) * edge, "#c9d0d8", small ? 9 : 10);

  // The aircraft, in the middle: nose up with the heading up, turned to its heading with north up.
  context.rotate(chart.heading * RADIANS - up);
  context.beginPath();
  AIRCRAFT.forEach(([x, y], i) => (i ? context.lineTo(x * aircraft, y * aircraft) : context.moveTo(x * aircraft, y * aircraft)));
  [...AIRCRAFT].reverse().forEach(([x, y]) => context.lineTo(-x * aircraft, y * aircraft));
  context.closePath();
  context.strokeStyle = HALO;
  context.lineWidth = 2.5;
  context.stroke();
  context.fillStyle = "#fff";
  context.fill();
  context.restore();
  return charted;
}
