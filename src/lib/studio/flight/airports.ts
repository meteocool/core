/**
 * The airports under a flight: their runways, taxiways and names, and the
 * lights along each runway.
 *
 * Out of the basemap's own tiles (layers/protomaps.ts), which carry
 * OpenStreetMap's aeroways among their roads: a runway as the line down its
 * middle, with its name where it is mapped ("08L/26R"), a taxiway as the
 * line along it; and the larger airports among their places of interest,
 * with a name, an IATA code and an elevation. A tile cuts a runway at its
 * edge, so the pieces of every tile round the aircraft are joined up again
 * here, and gathered into airports by how near they lie.
 *
 * The tiles say nothing of how wide a runway is or how it is lit, so both
 * are told from its length and whether it has a name: a long named runway is
 * a wide one with approach lights, a nameless strip a narrow one in the
 * dark. A runway nobody named is named as runways are, from the way it
 * points, though true north is all there is to go by, not magnetic.
 *
 * Arithmetic only: airportWorld.ts fetches the tiles, airportLayer.ts draws
 * what this makes of them.
 */
import { bearingDeg, distanceM, offsetM, wrap180, wrap360 } from "./geo";
import { readTileLayer } from "./tileFeatures";
import type { TileValue } from "./tileFeatures";

export type LonLat = [number, number];

/** A runway, or the part of one a tile holds: the two ends of the line down its middle. */
export interface RunwayPiece {
  from: LonLat;
  to: LonLat;
  /** Its name as mapped, "08L/26R"; null for none. */
  ref: string | null;
}

/** An airport as the map names it. */
export interface AirportName {
  lon: number;
  lat: number;
  name: string | null;
  iata: string | null;
  /** Metres above the sea; null where the map does not say. */
  elevation: number | null;
}

/** What one tile holds of airports. */
export interface TileAirports {
  runways: RunwayPiece[];
  /** Each taxiway as lon, lat, lon, lat along it. */
  taxiways: Float32Array[];
  names: AirportName[];
}

/**
 * How a runway is lit: not at all; along its edges and across its ends,
 * with a slope indicator beside it; or all of that with lights down its
 * middle and an approach's lights leading up to it.
 */
export type RunwayLighting = "none" | "basic" | "full";

export interface Runway {
  from: LonLat;
  to: LonLat;
  /** The way it runs from `from` to `to`, degrees true, and how long and wide it is, metres. */
  bearing: number;
  length: number;
  width: number;
  /** What it is called landing from `from` towards `to`, and the other way. */
  names: [string, string];
  lighting: RunwayLighting;
}

export interface Airport {
  name: string | null;
  iata: string | null;
  elevation: number | null;
  /** The middle of its runways. */
  lon: number;
  lat: number;
  runways: Runway[];
  taxiways: Float32Array[];
}

/** The basemap's layers the airports are read from, and what marks an airport in them. */
const ROADS = "roads";
const PLACES = "pois";
const AEROWAY = "aeroway";
const AERODROME = "aerodrome";

/** Where a point of tile (z, x, y) is on the earth, `px` and `py` of `extent` across and down it. */
function lonLat(z: number, x: number, y: number, px: number, py: number, extent: number): LonLat {
  const n = 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [((x + px / extent) / n) * 360 - 180, lat];
}

const textOf = (value: TileValue | undefined): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The runways, taxiways and airports' names in one basemap tile's bytes. */
export function airportsInTile(tile: ArrayBuffer | Uint8Array, z: number, x: number, y: number): TileAirports {
  const found: TileAirports = { runways: [], taxiways: [], names: [] };
  const roads = readTileLayer(tile, ROADS, (properties) => properties.kind === AEROWAY);
  for (const { type, properties, parts } of roads.features) {
    if (type !== 2) continue;
    const runway = properties.kind_detail === "runway";
    if (!runway && properties.kind_detail !== "taxiway") continue;
    for (const part of parts) {
      if (part.length < 4) continue;
      if (runway) {
        found.runways.push({
          from: lonLat(z, x, y, part[0], part[1], roads.extent),
          to: lonLat(z, x, y, part[part.length - 2], part[part.length - 1], roads.extent),
          ref: textOf(properties.ref),
        });
      } else {
        const line = new Float32Array(part.length);
        for (let i = 0; i < part.length; i += 2) line.set(lonLat(z, x, y, part[i], part[i + 1], roads.extent), i);
        found.taxiways.push(line);
      }
    }
  }
  const places = readTileLayer(tile, PLACES, (properties) => properties.kind === AERODROME);
  for (const { type, properties, parts } of places.features) {
    if (type !== 1 || !parts[0] || parts[0].length < 2) continue;
    const [lon, lat] = lonLat(z, x, y, parts[0][0], parts[0][1], places.extent);
    const elevation = Number(properties.elevation);
    found.names.push({
      lon, lat, name: textOf(properties.name), iata: textOf(properties.iata),
      elevation: properties.elevation !== undefined && Number.isFinite(elevation) ? elevation : null,
    });
  }
  return found;
}

/** A runway's number the other way: eighteen on, and left for right. */
function opposite(name: string): string {
  const number = ((Number(name.slice(0, 2)) + 17) % 36) + 1;
  const side = name.slice(2);
  return `${String(number).padStart(2, "0")}${side === "L" ? "R" : side === "R" ? "L" : side}`;
}

/**
 * What a runway is called each way: landing along `bearing` (degrees true),
 * and landing the other way. From its mapped name where that reads as one
 * ("08L/26R", "18"), whichever of its halves points nearer each way; from
 * the bearing alone otherwise, to the nearest ten degrees.
 */
export function designators(bearing: number, ref?: string | null): [string, string] {
  const parts = (ref ?? "").split("/")
    .map((part) => /^\s*(\d{1,2})\s*([LRC]?)\s*$/i.exec(part))
    .filter((match): match is RegExpExecArray => match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 36)
    .map((match) => `${match[1].padStart(2, "0")}${match[2].toUpperCase()}`);
  if (!parts.length) {
    const number = Math.round(wrap360(bearing) / 10) % 36 || 36;
    const along = String(number).padStart(2, "0");
    return [along, opposite(along)];
  }
  const off = (name: string) => Math.abs(wrap180(Number(name.slice(0, 2)) * 10 - bearing));
  if (parts.length === 1) return off(parts[0]) <= 90 ? [parts[0], opposite(parts[0])] : [opposite(parts[0]), parts[0]];
  const along = off(parts[0]) <= off(parts[1]) ? 0 : 1;
  return [parts[along], parts[1 - along]];
}

/** Two pieces lie on one line if neither end of one is further than this from the other's line, metres; */
const SAME_LINE_M = 12;
/** and are one runway if they overlap or come this near end to end, metres. */
const SAME_RUNWAY_GAP_M = 40;
/** Shorter than this is no runway: a stub of one whose rest is in a tile not read yet. Metres. */
const SHORTEST_RUNWAY_M = 200;

const lengthOf = (piece: RunwayPiece) => distanceM(piece.from[0], piece.from[1], piece.to[0], piece.to[1]);

/** The two as one piece, if they are parts of one runway; null if not. */
function union(a: RunwayPiece, b: RunwayPiece): RunwayPiece | null {
  if (a.ref && b.ref && a.ref !== b.ref) return null;
  const [east, north] = offsetM(a.from[0], a.from[1], a.to[0], a.to[1]);
  const length = Math.hypot(east, north);
  if (length < 1) return null;
  const along = (point: LonLat) => {
    const [e, n] = offsetM(a.from[0], a.from[1], point[0], point[1]);
    return [(e * east + n * north) / length, (n * east - e * north) / length];
  };
  const ends = [a.from, a.to, b.from, b.to].map((point) => ({ point, at: along(point) }));
  if (Math.abs(ends[2].at[1]) > SAME_LINE_M || Math.abs(ends[3].at[1]) > SAME_LINE_M) return null;
  const [low, high] = [Math.min(ends[2].at[0], ends[3].at[0]), Math.max(ends[2].at[0], ends[3].at[0])];
  if (high < -SAME_RUNWAY_GAP_M || low > length + SAME_RUNWAY_GAP_M) return null;
  ends.sort((one, other) => one.at[0] - other.at[0]);
  return { from: ends[0].point, to: ends[3].point, ref: a.ref ?? b.ref };
}

/** How wide a runway of this length most likely is, metres. */
export function widthFor(length: number): number {
  return length >= 2400 ? 45 : length >= 1200 ? 30 : length >= 700 ? 23 : 18;
}

/** How a runway of this length is most likely lit; an unnamed one is taken for a grass strip. */
function lightingFor(length: number, named: boolean): RunwayLighting {
  if (!named || length < 600) return "none";
  return length >= 1500 ? "full" : "basic";
}

/**
 * Whole runways from the pieces the tiles hold of them: pieces on one line
 * that meet or overlap are one runway, as long as its two furthest ends.
 */
export function joinRunways(pieces: readonly RunwayPiece[]): Runway[] {
  const joined: RunwayPiece[] = [];
  for (const piece of pieces) {
    let whole = piece;
    for (let i = 0; i < joined.length; i += 1) {
      // The longer of the two is the line the other is measured against.
      const one = lengthOf(joined[i]) >= lengthOf(whole) ? union(joined[i], whole) : union(whole, joined[i]);
      if (!one) continue;
      whole = one;
      joined.splice(i, 1);
      // What it has grown into may now reach one it did not before.
      i = -1;
    }
    joined.push(whole);
  }
  const runways: Runway[] = [];
  for (const { from, to, ref } of joined) {
    const length = distanceM(from[0], from[1], to[0], to[1]);
    if (length < SHORTEST_RUNWAY_M) continue;
    const bearing = bearingDeg(from[0], from[1], to[0], to[1]);
    runways.push({ from, to, bearing, length, width: widthFor(length), names: designators(bearing, ref), lighting: lightingFor(length, ref !== null) });
  }
  return runways;
}

/** Runways nearer each other than this are one airport's, metres. */
const SAME_AIRPORT_M = 2500;
/** An airport is the one a name stands for if the name is within this of one of its runways' middles, metres. */
const NAMED_WITHIN_M = 6000;
/** A taxiway is an airport's if it begins within this of its middle, metres. */
const TAXIWAY_WITHIN_M = 8000;

const middle = (runway: { from: LonLat; to: LonLat }): LonLat => [(runway.from[0] + runway.to[0]) / 2, (runway.from[1] + runway.to[1]) / 2];

function near(a: Runway, b: Runway): boolean {
  const of = (runway: Runway) => [runway.from, middle(runway), runway.to];
  return of(a).some((p) => of(b).some((q) => distanceM(p[0], p[1], q[0], q[1]) < SAME_AIRPORT_M));
}

/**
 * The airports in what a set of tiles holds: their runways joined up and
 * gathered by how near they lie, each group given the nearest name, and the
 * taxiways of the airport they begin at.
 */
export function airportsOf(tiles: readonly TileAirports[]): Airport[] {
  const runways = joinRunways(tiles.flatMap((tile) => tile.runways));
  // Each runway's group: the first runway of it.
  const group = runways.map((_runway, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index])));
  for (let i = 0; i < runways.length; i += 1) {
    for (let j = i + 1; j < runways.length; j += 1) {
      if (root(i) !== root(j) && near(runways[i], runways[j])) group[root(j)] = root(i);
    }
  }
  const byGroup = new Map<number, Airport>();
  runways.forEach((runway, index) => {
    const key = root(index);
    let airport = byGroup.get(key);
    if (!airport) {
      airport = { name: null, iata: null, elevation: null, lon: 0, lat: 0, runways: [], taxiways: [] };
      byGroup.set(key, airport);
    }
    airport.runways.push(runway);
  });
  const airports = [...byGroup.values()];
  const names = tiles.flatMap((tile) => tile.names);
  for (const airport of airports) {
    const middles = airport.runways.map(middle);
    airport.lon = middles.reduce((sum, point) => sum + point[0], 0) / middles.length;
    airport.lat = middles.reduce((sum, point) => sum + point[1], 0) / middles.length;
    // The longest first: the one an approach is most likely to.
    airport.runways.sort((a, b) => b.length - a.length);
    let nearest = NAMED_WITHIN_M;
    for (const name of names) {
      const distance = Math.min(...middles.map((point) => distanceM(point[0], point[1], name.lon, name.lat)));
      if (distance >= nearest) continue;
      nearest = distance;
      airport.name = name.name;
      airport.iata = name.iata;
      airport.elevation = name.elevation;
    }
  }
  for (const tile of tiles) {
    for (const taxiway of tile.taxiways) {
      let nearest = TAXIWAY_WITHIN_M;
      let home: Airport | null = null;
      for (const airport of airports) {
        const distance = distanceM(airport.lon, airport.lat, taxiway[0], taxiway[1]);
        if (distance < nearest) {
          nearest = distance;
          home = airport;
        }
      }
      home?.taxiways.push(taxiway);
    }
  }
  return airports;
}

/**
 * Floats a light takes: where it is, metres east, north and up of its
 * airport's middle (up is left at 0 here, for whoever knows the ground);
 * its colour; which way it shines, as east and north of a unit (0, 0 for
 * all round); and what else it does (`PAPI_*`, or a flash's turn).
 */
export const LIGHT_FLOATS = 9;

const WHITE = [1, 0.94, 0.78];
const GREEN = [0.25, 1, 0.45];
const RED = [1, 0.16, 0.1];

/** Between two lights along a runway's edge, and along its middle, metres. */
const EDGE_EVERY_M = 60;
const CENTRE_EVERY_M = 30;
/** How far an approach's lights lead up to a long runway, and to a shorter one, metres; and between two of them. */
const APPROACH_M = 900;
const APPROACH_SHORT_M = 420;
const APPROACH_EVERY_M = 30;
/** Where an approach's crossbar is, metres before the runway, and how wide. */
const CROSSBAR_M = 300;
const CROSSBAR_WIDE_M = 30;

/**
 * The slope indicator: four lights beside the runway, each white from
 * above its own angle and red from below it, so a pilot on the three
 * degrees down to the runway sees two of each. These are the angles, the
 * light nearest the runway first, degrees.
 */
export const PAPI_ANGLES = [3.5, 3.17, 2.83, 2.5];
/** How far past the runway's start the indicator stands, metres, or this share of a short runway; how far off its edge, and between two of its lights. */
const PAPI_ALONG_M = 300;
const PAPI_ALONG_SHARE = 0.15;
const PAPI_OFF_M = 15;
const PAPI_APART_M = 9;

/**
 * The lights of a runway, as so many `LIGHT_FLOATS` each, placed from
 * `origin` (its airport's middle).
 *
 * White along both edges; green across the start as an approach sees it
 * and red across the far end, each way; the slope indicator on the left of
 * each approach. A long runway has white down its middle too, and each
 * approach a line of lights leading up to it with a crossbar, the outer
 * ones flashing in turn towards the runway.
 */
export function runwayLights(runway: Runway, origin: LonLat): number[] {
  const lights: number[] = [];
  if (runway.lighting === "none") return lights;
  const [baseEast, baseNorth] = offsetM(origin[0], origin[1], runway.from[0], runway.from[1]);
  const radians = (runway.bearing * Math.PI) / 180;
  const [alongEast, alongNorth] = [Math.sin(radians), Math.cos(radians)];
  const half = runway.width / 2;
  /** A light `along` the runway from `from` and `across` to the right of it, shining `aim` (1 back along it, -1 on along it, 0 all round). */
  const put = (along: number, across: number, colour: number[], aim = 0, extra = 0) => {
    lights.push(
      baseEast + alongEast * along + alongNorth * across, baseNorth + alongNorth * along - alongEast * across, 0,
      colour[0], colour[1], colour[2], -alongEast * aim, -alongNorth * aim, extra,
    );
  };
  const full = runway.lighting === "full";

  const edges = Math.max(1, Math.round(runway.length / EDGE_EVERY_M));
  for (let i = 0; i <= edges; i += 1) {
    const along = (runway.length * i) / edges;
    put(along, -half, WHITE);
    put(along, half, WHITE);
  }
  if (full) {
    const count = Math.round(runway.length / CENTRE_EVERY_M);
    for (let i = 1; i < count; i += 1) put((runway.length * i) / count, 0, WHITE);
  }

  // Each way it is landed on: `way` 1 from `from`, -1 from `to`.
  for (const way of [1, -1]) {
    const start = way === 1 ? 0 : runway.length;
    const end = runway.length - start;
    const across = Math.max(4, Math.round(runway.width / 5));
    for (let i = 0; i <= across; i += 1) {
      const side = -half + (runway.width * i) / across;
      put(start - way * 2, side, GREEN, way);
      put(end + way * 2, side, RED, way);
    }
    const papiAlong = Math.min(PAPI_ALONG_M, runway.length * PAPI_ALONG_SHARE);
    PAPI_ANGLES.forEach((angle, index) => {
      put(start + way * papiAlong, -way * (half + PAPI_OFF_M + PAPI_APART_M * index), WHITE, way, angle);
    });
    if (!full) continue;
    const reach = runway.length >= 2400 ? APPROACH_M : APPROACH_SHORT_M;
    for (let out = APPROACH_EVERY_M; out <= reach; out += APPROACH_EVERY_M) {
      put(start - way * out, 0, WHITE, way);
      // Past the crossbar, every other one flashes too, the furthest first.
      if (out > CROSSBAR_M && out % (2 * APPROACH_EVERY_M) === 0) put(start - way * out, 0, WHITE, way, -(1 - (out - CROSSBAR_M) / (reach - CROSSBAR_M) + 0.01));
    }
    for (let i = 0; i < 8; i += 1) {
      const side = -CROSSBAR_WIDE_M / 2 + (CROSSBAR_WIDE_M * i) / 7;
      if (Math.abs(side) > 3) put(start - way * CROSSBAR_M, side, WHITE, way);
    }
  }
  return lights;
}

/** An airport as the aircraft has it: which it is, the runway to land on and from which end, and the way there. */
export interface AirportFix {
  airport: Airport;
  runway: Runway;
  /** Its name landing this way. */
  name: string;
  /** To the start of that runway: metres, and degrees true. */
  distance: number;
  bearing: number;
  /** The way the runway points landing on it, degrees true. */
  course: number;
}

/** A runway each way it is landed on: where it starts, the way it points, and what it is called. */
function approaches(runway: Runway): Array<{ start: LonLat; course: number; name: string }> {
  return [
    { start: runway.from, course: runway.bearing, name: runway.names[0] },
    { start: runway.to, course: wrap360(runway.bearing + 180), name: runway.names[1] },
  ];
}

/** A kilometre of runway is worth this many degrees off a straight-in approach, choosing between an airport's runways. */
const DEGREES_A_KM = 8;

/**
 * The nearest airport to a place, by its middle, and the runway of it to
 * land on from there: the one most nearly straight ahead on the way in,
 * a longer one before a shorter. Where `fit` is given and any runway known
 * is fit, only those and their airports count: an airliner is not sent to
 * the grass strip it happens to be over. Null with no airport known.
 */
export function nearestAirport(airports: readonly Airport[], lon: number, lat: number, fit?: (runway: Runway) => boolean): AirportFix | null {
  if (fit && !airports.some((airport) => airport.runways.some(fit))) return nearestAirport(airports, lon, lat);
  const wanted = fit ?? (() => true);
  let nearest: Airport | null = null;
  let least = Infinity;
  for (const airport of airports) {
    if (!airport.runways.some(wanted)) continue;
    const distance = distanceM(lon, lat, airport.lon, airport.lat);
    if (distance < least) {
      least = distance;
      nearest = airport;
    }
  }
  if (!nearest) return null;
  let best: AirportFix | null = null;
  let bestOff = Infinity;
  for (const runway of nearest.runways.filter(wanted)) {
    for (const { start, course, name } of approaches(runway)) {
      const bearing = bearingDeg(lon, lat, start[0], start[1]);
      const off = Math.abs(wrap180(course - bearing)) - (runway.length / 1000) * DEGREES_A_KM;
      if (off >= bestOff) continue;
      bestOff = off;
      best = { airport: nearest, runway, name, distance: distanceM(lon, lat, start[0], start[1]), bearing, course };
    }
  }
  return best;
}

/** How far off a runway's edge still counts as on it, metres: the tiles place its middle to a few metres only. */
const ON_RUNWAY_SPARE_M = 12;

/**
 * The runway a place is on, and what it is called going `heading`'s way;
 * null on none.
 */
export function runwayAt(airports: readonly Airport[], lon: number, lat: number, heading: number): { airport: Airport; runway: Runway; name: string } | null {
  for (const airport of airports) {
    for (const runway of airport.runways) {
      const [east, north] = offsetM(runway.from[0], runway.from[1], lon, lat);
      const radians = (runway.bearing * Math.PI) / 180;
      const along = east * Math.sin(radians) + north * Math.cos(radians);
      const across = east * Math.cos(radians) - north * Math.sin(radians);
      if (along < 0 || along > runway.length || Math.abs(across) > runway.width / 2 + ON_RUNWAY_SPARE_M) continue;
      const name = Math.abs(wrap180(heading - runway.bearing)) <= 90 ? runway.names[0] : runway.names[1];
      return { airport, runway, name };
    }
  }
  return null;
}
