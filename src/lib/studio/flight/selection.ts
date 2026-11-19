/**
 * Which volumes the map holds and draws fine while flying.
 *
 * The map's own choice works from the screen: what its bounds hold, what
 * projects onto it, how many pixels a tile stands across. From a cockpit
 * that is all meaningless: the camera looks at the horizon, its bounds run
 * to the edge of the world, the centre is a point in the air ahead, and a
 * storm behind projects to anywhere. So in flight the aircraft decides: the
 * storms ahead of it and around it, nearest first, and fine where it is
 * close enough to see a coarse tile's kilometre voxels.
 */
import { fineWithin } from "../../volumeLevels";
import { bearingDeg, distanceM, wrap180 } from "./geo";

/** Where the aircraft is and which way it faces; enough of a pose for choosing. */
export interface Lookout {
  lon: number;
  lat: number;
  heading: number;
  /** The camera's horizontal field of view, degrees. */
  fovDeg: number;
}

/** As far as volumes are held, km; and how close one stands that is held whichever way it is. */
export const HOLD_KM = 300;
const AROUND_KM = 30;
/** How far either side of the field of view's edge still counts as ahead, degrees. */
const SECTOR_MARGIN_DEG = 20;

/** Closer than this a coarse tile is drawn as its tiles, km; it goes back to coarse past the second. */
export const FINE_WITHIN_KM = 70;
export const COARSE_BEYOND_KM = 90;

const KM = 1000;

/** Whether a point is ahead of the aircraft, within the field of view and a margin; or close by. */
export function ahead(lookout: Lookout, lon: number, lat: number, km: number): boolean {
  if (km <= AROUND_KM) return true;
  const off = Math.abs(wrap180(bearingDeg(lookout.lon, lookout.lat, lon, lat) - lookout.heading));
  return off <= lookout.fovDeg / 2 + SECTOR_MARGIN_DEG;
}

/**
 * The volumes to hold, of `candidates`: within `HOLD_KM`, those ahead or
 * close by first, then the rest, nearest first among each, as far as
 * `budget` bytes go.
 */
export function flightWanted<T extends { lon: number; lat: number }>(
  candidates: readonly T[], lookout: Lookout, budget: number, bytesOf: (volume: T) => number,
): T[] {
  const placed = candidates.map((volume) => {
    const km = distanceM(lookout.lon, lookout.lat, volume.lon, volume.lat) / KM;
    return { volume, km, front: ahead(lookout, volume.lon, volume.lat, km) };
  }).filter(({ km }) => km <= HOLD_KM);
  placed.sort((a, b) => Number(b.front) - Number(a.front) || a.km - b.km);
  const held: T[] = [];
  let bytes = 0;
  for (const { volume } of placed) {
    bytes += bytesOf(volume);
    if (bytes > budget) break;
    held.push(volume);
  }
  return held;
}

/** A coarse tile, where it stands and what drawing it either way costs. */
export interface CoarsePlace {
  code: string;
  lon: number;
  lat: number;
  coarseBytes: number;
  fineBytes: number;
}

/** Whether a coarse tile is near enough to be drawn as its tiles, with the hysteresis `wasFine` gives. */
export function nearEnoughForFine(lookout: Pick<Lookout, "lon" | "lat">, lon: number, lat: number, wasFine: boolean): boolean {
  const km = distanceM(lookout.lon, lookout.lat, lon, lat) / KM;
  return km < (wasFine ? COARSE_BEYOND_KM : FINE_WITHIN_KM);
}

/**
 * Which coarse tiles to draw as their tiles: those near enough, nearest
 * first, as far as `spare` bytes over drawing all of them coarse go (the
 * map's own `fineWithin`, with nearness for size on screen).
 */
export function flightFine(
  places: readonly CoarsePlace[], lookout: Pick<Lookout, "lon" | "lat">, wasFine: ReadonlySet<string>, spare: number,
): Set<string> {
  const candidates = places
    .filter((place) => nearEnoughForFine(lookout, place.lon, place.lat, wasFine.has(place.code)))
    .map((place) => ({
      code: place.code,
      // Nearer counts as larger: `fineWithin` takes the largest first.
      across: 1 / Math.max(1, distanceM(lookout.lon, lookout.lat, place.lon, place.lat)),
      coarseBytes: place.coarseBytes,
      fineBytes: place.fineBytes,
    }));
  return fineWithin(candidates, spare);
}

/** Whether a point is within `HOLD_KM` of the aircraft. */
export const withinHold = (lookout: Pick<Lookout, "lon" | "lat">, lon: number, lat: number): boolean => (
  distanceM(lookout.lon, lookout.lat, lon, lat) / KM <= HOLD_KM
);
