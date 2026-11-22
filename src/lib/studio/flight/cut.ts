/**
 * Where the flight's cut through a storm stands, and how the reader moves it.
 *
 * An upright section plane, as Studio's are (lib/studio/planes.ts): it is
 * set facing the aircraft when the storm is first cut open, and from then
 * on stays as it was set, wherever the aircraft flies, until the reader
 * turns it, pushes it, or turns it to face them again. It goes with the
 * storm as the storm moves, through the storm's mark pushed so far along it.
 */
import type { FlightCut } from "../director";
import { bearingDeg, destination, wrap360 } from "./geo";

/** How far the cut is pushed to either side of the storm's middle at most, km. */
export const CUT_PUSH_KM = 20;
/** How far a key turns the cut, degrees, and pushes it, km. */
export const CUT_TURN_STEP = 10;
export const CUT_PUSH_STEP = 1;
/**
 * How far the cut is drawn to either side of its point, km, seen from near:
 * about as far as it cuts, which is every cloud within some 40 km of the
 * point (layers/cellVolumeLayer.ts, `CUT_REACH_KM`). From further off it is
 * drawn wider, this share of the way to it to either side, so that it still
 * reads as a plane across the view rather than a sliver over the storm; up
 * to `CUT_HALF_MOST_KM`.
 */
export const CUT_HALF_KM = 30;
export const CUT_WIDENS = 0.4;
export const CUT_HALF_MOST_KM = 150;

export interface CutSetting {
  /** The compass direction of the side taken away; null until set, by the aircraft's place, on cutting. */
  facingDeg: number | null;
  /** How far past the storm's middle, away from the side taken away, km: more cuts deeper. */
  pushKm: number;
}

export const UNSET_CUT: CutSetting = { facingDeg: null, pushKm: 0 };

/** A setting facing the eye, wherever it is: the side towards it taken away. */
export function facingFrom(setting: CutSetting, eye: { lon: number; lat: number }, storm: { lon: number; lat: number }): CutSetting {
  return { ...setting, facingDeg: bearingDeg(storm.lon, storm.lat, eye.lon, eye.lat) };
}

/** The setting turned so many degrees clockwise, and pushed so many kilometres deeper, within `CUT_PUSH_KM`. */
export function moved(setting: CutSetting & { facingDeg: number }, turnDeg: number, pushKm: number): CutSetting & { facingDeg: number } {
  return {
    facingDeg: wrap360(setting.facingDeg + turnDeg),
    pushKm: Math.min(Math.max(setting.pushKm + pushKm, -CUT_PUSH_KM), CUT_PUSH_KM),
  };
}

/** Where the cut through a storm stands, by a setting that has a facing; drawn as wide as it is seen from `eyeKm` away. */
export function cutThrough(
  storm: { lon: number; lat: number }, setting: CutSetting & { facingDeg: number }, eyeKm = 0,
): FlightCut {
  // Deeper is away from the side taken away.
  const [lon, lat] = setting.pushKm === 0
    ? [storm.lon, storm.lat]
    : destination(storm.lon, storm.lat, wrap360(setting.facingDeg + 180), setting.pushKm * 1000);
  const halfKm = Math.min(Math.max(CUT_HALF_KM, eyeKm * CUT_WIDENS), CUT_HALF_MOST_KM);
  return { lon, lat, facingDeg: setting.facingDeg, halfKm };
}
