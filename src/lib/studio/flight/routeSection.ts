/**
 * The section along a route: the radar's field on an upright sheet that
 * follows a path over the ground, as far up as the storms stand.
 *
 * A cut (flight/cut.ts) opens one storm along one straight plane. This asks
 * the other question: what a path passes through, whichever storms those
 * are and however it bends. So it is read from the volumes held, column by
 * column along the path, and is a picture of its own: nothing is cut away
 * for it, and the storms stand as they are.
 *
 * In flight the path is the aircraft's track, from a little behind it to as
 * far ahead as the radar's storms are held in detail, and the sheet is laid
 * flat on the flight deck (FlightProfile.svelte): stood upright along the
 * track it is edge on to every eye a flight has.
 */
import type { Cutaway } from "../../cellCutaway";
import { destination, distanceM, offsetM } from "./geo";
import { reflectivityAt } from "./weather";

/** How far behind the aircraft a flight's section starts, and how far ahead it runs, metres. */
export const SECTION_BEHIND_M = 5_000;
export const SECTION_AHEAD_M = 160_000;
/** How high it stands, metres: the tallest a storm's box does. */
export const SECTION_TOP_M = 16_000;
/** What one of its samples covers, along the path and upwards, metres: about a voxel of the finest volumes each way. */
const COLUMN_M = 300;
const ROW_M = 500;
/** A straight path is laid out as points this far apart at most, metres, so that it follows the Earth. */
const LEG_M = 40_000;

type Volume = Pick<Cutaway, "header" | "voxels" | "extentM">;

/** The section along a path: where the path runs, and the echo on the sheet over it. */
export interface RouteSection {
  /** The path on the ground, [lon, lat], and how far along it each point is, metres. */
  points: Array<[number, number]>;
  along: number[];
  lengthM: number;
  topM: number;
  /** The echo: `columns` along the path by `rows` up from the ground, the ground's row first; see `echoByte`. */
  columns: number;
  rows: number;
  echo: Uint8Array;
  /** A height marked on it, metres, and how far along, metres: the aircraft's; null for none. */
  mark: { alongM: number; altitude: number } | null;
}

/**
 * A reflectivity as the sheet stores it: nothing as 0, and from -32 to 64
 * dBZ as 1 to 255, which is where the palette's ramp has it.
 */
export function echoByte(dbz: number | null): number {
  if (dbz === null || dbz === -Infinity) return 0;
  return Math.min(Math.max(Math.round(((dbz + 32) / 96) * 255), 1), 255);
}

/** A straight path from a point along a compass direction, from `behindM` behind it to `aheadM` ahead. */
export function trackPath(lon: number, lat: number, track: number, behindM: number, aheadM: number): Array<[number, number]> {
  const legs = Math.max(1, Math.ceil((behindM + aheadM) / LEG_M));
  return Array.from({ length: legs + 1 }, (_, i) => {
    const at = -behindM + ((behindM + aheadM) * i) / legs;
    return at === 0 ? [lon, lat] : destination(lon, lat, at < 0 ? track + 180 : track, Math.abs(at));
  });
}

/** How far along a path each of its points is, metres. */
export function alongOf(points: ReadonlyArray<readonly [number, number]>): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1] + distanceM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return along;
}

/** The point so far along a path, metres: between the two of its points either side. */
export function pointAlong(points: ReadonlyArray<readonly [number, number]>, along: readonly number[], at: number): [number, number] {
  let leg = 1;
  while (leg < points.length - 1 && along[leg] < at) leg += 1;
  const span = along[leg] - along[leg - 1];
  const t = span > 0 ? Math.min(Math.max((at - along[leg - 1]) / span, 0), 1) : 0;
  return [
    points[leg - 1][0] + (points[leg][0] - points[leg - 1][0]) * t,
    points[leg - 1][1] + (points[leg][1] - points[leg - 1][1]) * t,
  ];
}

/**
 * The section along a path through the volumes held: the strongest echo of
 * those that reach each sample, and nothing where none does.
 */
export function sectionAlong(
  cutaways: Iterable<Volume>, points: Array<[number, number]>, topM = SECTION_TOP_M,
  mark: RouteSection["mark"] = null,
): RouteSection {
  const along = alongOf(points);
  const lengthM = along[along.length - 1];
  const columns = Math.max(1, Math.round(lengthM / COLUMN_M));
  const rows = Math.max(1, Math.round(topM / ROW_M));
  const echo = new Uint8Array(columns * rows);
  const held = [...cutaways];
  for (let column = 0; column < columns; column += 1) {
    const [lon, lat] = pointAlong(points, along, ((column + 0.5) / columns) * lengthM);
    // The few volumes over this point of the ground, found once for the whole column.
    const over = held.filter(({ header, extentM }) => {
      const [east, north] = offsetM(header.lon, header.lat, lon, lat);
      return Math.abs(east) < extentM[0] / 2 && Math.abs(north) < extentM[1] / 2;
    });
    if (!over.length) continue;
    for (let row = 0; row < rows; row += 1) {
      echo[row * columns + column] = echoByte(reflectivityAt(over, lon, lat, ((row + 0.5) / rows) * topM));
    }
  }
  return { points, along, lengthM, topM, columns, rows, echo, mark };
}

/** The section along an aircraft's track, with the aircraft marked on it. */
export function trackSection(
  cutaways: Iterable<Volume>, from: { lon: number; lat: number; track: number; altitude: number },
): RouteSection {
  return sectionAlong(
    cutaways, trackPath(from.lon, from.lat, from.track, SECTION_BEHIND_M, SECTION_AHEAD_M), SECTION_TOP_M,
    { alongM: SECTION_BEHIND_M, altitude: from.altitude },
  );
}
