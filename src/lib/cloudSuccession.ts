import type { Cutaway } from "./cellCutaway";

/**
 * Telling a storm apart from a newer scan of itself.
 *
 * A volume is one core in one scan, and nothing links it to the next scan's:
 * a core's code is its peak's grid position, so it changes whenever the peak
 * moves a pixel, and stays the same when a different storm's peak lands on
 * that pixel. Where two volumes have to be recognised as one storm -- the 3D
 * map keeps an open storm past its scan, and must then not draw the newer
 * scan of it as well -- all there is to go on is where their echo is.
 */

const KM_PER_DEGREE = 111.32;

/**
 * How much of a newer storm has to lie over the open one to be taken for it.
 *
 * As a share of the smaller of the two storms' footprints. Well under half,
 * because five minutes of drift moves a small shower most of its own width;
 * well over nothing, because a neighbouring storm whose anvil brushes the open
 * one's is a different storm and stays drawn.
 */
const SUCCESSOR_OVERLAP = 0.3;

/**
 * A storm's footprint as [west, south, east, north] km from `origin`.
 *
 * Where its echo is, from the volume's own framing, rather than its box: the
 * box is a fixed 40 km around the peak whatever the storm's size.
 */
export function footprintKm(cutaway: Cutaway, origin: { lon: number; lat: number }): [number, number, number, number] {
  const { header, centreKm, halfKm } = cutaway;
  const east = (header.lon - origin.lon) * KM_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180) + centreKm[0];
  const north = (header.lat - origin.lat) * KM_PER_DEGREE + centreKm[1];
  return [east - halfKm[0], north - halfKm[1], east + halfKm[0], north + halfKm[1]];
}

/** Whether `later` is, most likely, `earlier` as a later scan saw it. */
export function isSuccessor(earlier: Cutaway, later: Cutaway): boolean {
  const a = footprintKm(earlier, earlier.header);
  const b = footprintKm(later, earlier.header);
  const across = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const up = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (across <= 0 || up <= 0) return false;
  const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return smaller > 0 && (across * up) / smaller >= SUCCESSOR_OVERLAP;
}
