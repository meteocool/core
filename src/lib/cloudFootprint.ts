/**
 * Where a storm's box stands on the ground, and where its cut turns.
 *
 * The 3D map marks every storm it could open with the outline of the box the
 * cutaway raymarches and a chip on the cut's spin axis, so a reader sees
 * before tapping what will open and what it will turn around. Both must sit
 * exactly where the volume will: the box is placed by `cellVolumeLayer.ts`'s
 * model matrix, a square in Mercator scaled by the metre at the box's centre,
 * so this does the same arithmetic rather than a geodesic one that would
 * disagree with it by a few hundred metres at the corners.
 *
 * The spin axis is the vertical through the storm, not the box's centre: the
 * cut is laid through `Cutaway.centreKm` (see `locateStorm`), and turning it
 * turns the plane about that point. Until the volume has loaded it is not
 * known, and the box's centre -- the core's peak, which the box is centred on
 * -- stands in for it.
 */

/** The box's width, east to west and north to south, as the worker builds it (`voxels.HALF_WIDTH_M`). */
export const BOX_KM = 40;

/** MapLibre's earth, so a metre here is the metre its Mercator coordinates use. */
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8;

const mercatorX = (lon: number) => (180 + lon) / 360;
const mercatorY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
const lonOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;

/** A lon/lat pair, as GeoJSON orders it. */
export type LonLat = [number, number];

export interface Footprint {
  /** The box's outline, closed: south-west, south-east, north-east, north-west, south-west. */
  ring: LonLat[];
  /** Where the cut's spin axis meets the ground. */
  pivot: LonLat;
}

/**
 * The footprint of a box centred on `lon`/`lat`.
 *
 * `extentM` is the box's size east and north, from its header once loaded;
 * `centreKm` the storm's offset from the box's centre, east and north, which
 * the cut turns about.
 */
export function boxFootprint(
  lon: number,
  lat: number,
  extentM: readonly [number, number] = [BOX_KM * 1000, BOX_KM * 1000],
  centreKm: readonly [number, number] = [0, 0],
): Footprint {
  const x = mercatorX(lon);
  const y = mercatorY(lat);
  const metre = 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));
  const halfX = (extentM[0] / 2) * metre;
  const halfY = (extentM[1] / 2) * metre;
  // Mercator's y runs south, so north is minus.
  const at = (dx: number, dy: number): LonLat => [lonOf(x + dx), latOf(y - dy)];
  return {
    ring: [at(-halfX, -halfY), at(halfX, -halfY), at(halfX, halfY), at(-halfX, halfY), at(-halfX, -halfY)],
    pivot: at(centreKm[0] * 1000 * metre, centreKm[1] * 1000 * metre),
  };
}
