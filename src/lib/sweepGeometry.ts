/**
 * Where a radar's beam is: from a point on the map to the bin that measured it, and back.
 *
 * The same projection `layers/siteSweep.ts` runs per pixel in its fragment
 * shader, written once more here for the CPU, so a long press reads the very
 * bin the map coloured under the finger, and so the tests can hold the two to
 * each other. Change one, change both.
 *
 * Distances on the ground are great-circle on a sphere of the earth's mean
 * radius; the beam is bent by the standard atmosphere, which is the same as
 * a straight beam over an earth four thirds the size (the textbook model, and
 * wradlib's, which the ng side uses). Over a ground distance `s` from a radar
 * tilted `theta` up, on that earth of radius R':
 *
 *     slant range  r = R' sin(s / R') / cos(theta + s / R')
 *     beam height  h = R' cos(theta) / cos(theta + s / R') - R' (+ the antenna's own height)
 *
 * Pure: no OpenLayers objects and nothing of Vite's.
 */

export const EARTH_RADIUS_M = 6_371_000;
/** The 4/3 earth refraction makes of a straight beam. */
export const EFFECTIVE_RADIUS_M = (4 / 3) * EARTH_RADIUS_M;

const RAD = Math.PI / 180;

/** The parts of a sweep's header its geometry needs. */
export interface SweepGeometry {
  lat: number;
  lon: number;
  height_m: number;
  elevation_deg: number;
  range_start_m: number;
  range_step_m: number;
  nrays: number;
  nbins: number;
  azimuth0_deg: number;
  azimuth_step_deg: number;
}

/** How far over the ground, in metres, and on which bearing, clockwise from north, a point is from a site. */
export function fromSite(siteLon: number, siteLat: number, lon: number, lat: number): { groundM: number; azimuthDeg: number } {
  const phi1 = siteLat * RAD;
  const phi2 = lat * RAD;
  const dPhi = phi2 - phi1;
  const dLambda = (lon - siteLon) * RAD;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const groundM = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const azimuthDeg = ((Math.atan2(y, x) / RAD) + 360) % 360;
  return { groundM, azimuthDeg };
}

/** Along the beam, and above the antenna, at a ground distance from the site; both in metres. */
export function alongBeam(groundM: number, elevationDeg: number): { slantM: number; heightM: number } {
  const k = EFFECTIVE_RADIUS_M;
  const theta = elevationDeg * RAD;
  const s = groundM / k;
  const cos = Math.cos(theta + s);
  return { slantM: (k * Math.sin(s)) / cos, heightM: (k * Math.cos(theta)) / cos - k };
}

/** The ground distance at which a tilt's beam centre is `heightM` above its antenna. */
export function groundAtHeight(heightM: number, elevationDeg: number): number {
  // h(s) = k cos(theta) / cos(theta + s) - k, solved for s.
  const k = EFFECTIVE_RADIUS_M;
  const theta = elevationDeg * RAD;
  const ratio = (k * Math.cos(theta)) / (k + heightM);
  return k * (Math.acos(Math.min(1, Math.max(-1, ratio))) - theta);
}

/** One bin of a sweep, as a point on the map lands on it. */
export interface BinAt {
  ray: number;
  bin: number;
  /** The ray's own centre, and the point's distances. */
  azimuthDeg: number;
  groundM: number;
  slantM: number;
  /** The beam centre above sea level there. */
  heightM: number;
}

/** Which bin a point falls in, nearest ray and the bin it is inside; null past the last bin or before the first. */
export function binAt(sweep: SweepGeometry, lon: number, lat: number): BinAt | null {
  const { groundM, azimuthDeg } = fromSite(sweep.lon, sweep.lat, lon, lat);
  const { slantM, heightM } = alongBeam(groundM, sweep.elevation_deg);
  if (!Number.isFinite(slantM) || slantM < 0) return null;
  const bin = Math.floor((slantM - sweep.range_start_m) / sweep.range_step_m);
  if (bin < 0 || bin >= sweep.nbins) return null;
  const steps = Math.round((azimuthDeg - sweep.azimuth0_deg) / sweep.azimuth_step_deg);
  const ray = ((steps % sweep.nrays) + sweep.nrays) % sweep.nrays;
  return {
    ray,
    bin,
    azimuthDeg: (sweep.azimuth0_deg + ray * sweep.azimuth_step_deg) % 360,
    groundM,
    slantM,
    heightM: heightM + sweep.height_m,
  };
}

/** How far a sweep's last bin reaches over the ground. */
export function reachM(sweep: SweepGeometry): number {
  const slant = sweep.range_start_m + sweep.nbins * sweep.range_step_m;
  // Slant to ground on the 4/3 earth: invert r(s) numerically, it is monotonic here.
  let low = 0;
  let high = slant;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (alongBeam(mid, sweep.elevation_deg).slantM < slant) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * The rings of beam height a tilt is drawn with: every whole kilometre above
 * sea level the beam centre reaches inside the sweep, at its ground distance.
 */
export function beamHeightRings(sweep: SweepGeometry, stepM = 1000): Array<{ heightM: number; groundM: number }> {
  const reach = reachM(sweep);
  const rings: Array<{ heightM: number; groundM: number }> = [];
  const first = Math.max(stepM, Math.ceil(sweep.height_m / stepM) * stepM);
  for (let height = first; ; height += stepM) {
    const groundM = groundAtHeight(height - sweep.height_m, sweep.elevation_deg);
    if (!(groundM > 0) || groundM > reach) break;
    rings.push({ heightM: height, groundM });
  }
  return rings;
}

/** A storm's motion: how fast, and which way it is going, clockwise from north. */
export interface Motion {
  speedMs: number;
  headingDeg: number;
}

/**
 * Storm-relative velocity: the radial wind less the storm's own motion along
 * the ray. A couplet riding a fast storm reads lopsided as measured; with the
 * storm's motion taken out, its two halves read as the rotation alone.
 */
export function stormRelative(radialMs: number, azimuthDeg: number, motion: Motion): number {
  return radialMs - motion.speedMs * Math.cos((azimuthDeg - motion.headingDeg) * RAD);
}
