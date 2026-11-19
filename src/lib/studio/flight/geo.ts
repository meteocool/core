/**
 * Distances and directions over the earth, for the flight.
 *
 * The aircraft covers hundreds of kilometres, where a flat-earth step in
 * degrees drifts off its heading as the meridians close in. So positions are
 * moved along great circles on a sphere: within a few metres of the ellipsoid
 * over a flight, which is far finer than anything drawn.
 */

/** The earth's mean radius, in metres: the sphere MapLibre measures on. */
export const EARTH_RADIUS_M = 6371008.8;

const RADIANS = Math.PI / 180;

/** Degrees into [0, 360). */
export function wrap360(degrees: number): number {
  const folded = degrees % 360;
  return folded < 0 ? folded + 360 : folded;
}

/** Degrees into (-180, 180]: a turn to the right is positive. */
export function wrap180(degrees: number): number {
  const folded = wrap360(degrees);
  return folded > 180 ? folded - 360 : folded;
}

/** How far apart two points are, in metres (haversine). */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const phi1 = lat1 * RADIANS;
  const phi2 = lat2 * RADIANS;
  const dPhi = phi2 - phi1;
  const dLambda = (lon2 - lon1) * RADIANS;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The direction to set off in from the first point to reach the second, degrees clockwise from north. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const phi1 = lat1 * RADIANS;
  const phi2 = lat2 * RADIANS;
  const dLambda = (lon2 - lon1) * RADIANS;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return wrap360(Math.atan2(y, x) / RADIANS);
}

/** Where a point ends up after `distance` metres along a great circle setting off on `bearing`. */
export function destination(lon: number, lat: number, bearing: number, distance: number): [number, number] {
  const delta = distance / EARTH_RADIUS_M;
  const theta = bearing * RADIANS;
  const phi1 = lat * RADIANS;
  const lambda1 = lon * RADIANS;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * sinPhi2,
  );
  return [wrap180(lambda2 / RADIANS), phi2 / RADIANS];
}

/**
 * Where a point stands from another, in metres east and north of it: flat,
 * which over the tens of kilometres this is used for is exact enough.
 */
export function offsetM(fromLon: number, fromLat: number, lon: number, lat: number): [number, number] {
  const metresPerDegree = EARTH_RADIUS_M * RADIANS;
  return [
    wrap180(lon - fromLon) * metresPerDegree * Math.cos(((fromLat + lat) / 2) * RADIANS),
    (lat - fromLat) * metresPerDegree,
  ];
}
