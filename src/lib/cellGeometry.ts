/**
 * The geometry behind the storm cell layer, in degrees.
 *
 * Kept free of OpenLayers so it can be tested directly, the way `apiHealth` and
 * `degraded` are: the projection is applied by the caller, at the edge. Two
 * things here are easy to get wrong and impossible to see wrong -- a bearing
 * read as a maths angle still draws a plausible ellipse pointing the wrong way,
 * and the viewport padding decides how often a pan costs a request.
 */

const ELLIPSE_POINTS = 36;
export const KM_PER_DEGREE_LAT = 111.32;

/** A viewport as [minLon, minLat, maxLon, maxLat], matching `mapExtent4326`. */
export type Extent = [number, number, number, number];

/**
 * A ring approximating one uncertainty ellipse, as [lon, lat] pairs.
 *
 * DWD gives the axes in kilometres and the angle as a bearing -- clockwise from
 * north -- rather than the counter-clockwise-from-east convention the maths
 * wants, which is why north and east are built from cos and sin the way round
 * they are. A degree of longitude also shrinks with latitude, so the east
 * offset is scaled by the cosine; without that an ellipse over Hamburg comes
 * out visibly wider than the same one over the Alps.
 */
export function ellipseRing4326(
  lon: number,
  lat: number,
  majorKm: number,
  minorKm: number,
  angleDeg: number,
): [number, number][] {
  const bearing = (angleDeg * Math.PI) / 180;
  const lonScale = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= ELLIPSE_POINTS; i += 1) {
    const t = (2 * Math.PI * i) / ELLIPSE_POINTS;
    const along = majorKm * Math.cos(t);
    const across = minorKm * Math.sin(t);
    const north = along * Math.cos(bearing) - across * Math.sin(bearing);
    const east = along * Math.sin(bearing) + across * Math.cos(bearing);
    ring.push([lon + east / lonScale, lat + north / KM_PER_DEGREE_LAT]);
  }
  return ring;
}

/** Minutes since a track was last detected, which is what drives its fading. */
export function ageMinutes(lastSeen: string, now = Date.now()): number {
  return (now - new Date(lastSeen).getTime()) / 60_000;
}

/**
 * Grow an extent by a fraction of its own size.
 *
 * Panning within the padding then costs no request, and a storm just off the
 * edge is already drawn by the time it comes into view.
 */
export function padExtent(extent: Extent, fraction: number): Extent {
  const [west, south, east, north] = extent;
  const padX = (east - west) * fraction;
  const padY = (north - south) * fraction;
  return [west - padX, south - padY, east + padX, north + padY];
}

/**
 * Scale a ring about a point so it encloses `ratio` times the area.
 *
 * Area grows with the square of a linear factor, so the factor is its root.
 * Getting that wrong does not throw and does not look obviously broken -- every
 * storm core just comes out far too small, which reads as a weak storm.
 */
export function scaleRing(
  ring: number[][],
  centre: [number, number],
  ratio: number,
): [number, number][] {
  const k = Math.sqrt(Math.max(ratio, 0));
  return ring.map(([lon, lat]) => [
    centre[0] + (lon - centre[0]) * k,
    centre[1] + (lat - centre[1]) * k,
  ]);
}

/** Close a ring if the source did not; GeoJSON requires first === last. */
export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Whether `inner` is entirely inside `outer`: nothing new has come into view. */
export function covers(outer: Extent | null, inner: Extent): boolean {
  if (!outer) return false;
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}
