/**
 * The cockpit's own aircraft as the airspace is told of it (wire.ts): from
 * the pilot's telemetry and what has happened to its airframe, written in
 * place into one state that is sent again and again.
 */
import type { Damage } from "../damage";
import type { Telemetry } from "../pilot";
import { encodeLook, lookOf, blankLook } from "./look";
import { GEAR_DOWN, ON_GROUND, PAUSED, WARPED } from "./wire";
import type { OwnState } from "./wire";

const RADIANS = Math.PI / 180;
/** How much faster time runs under warp: the cockpit's own (pilot.ts's `WARP`), which is not imported here so as not to bring the pilot along. */
export const WARP_FACTOR = 4;

export function blankOwn(): OwnState {
  return { flags: 0, lon: 0, lat: 0, altitude: 0, east: 0, north: 0, up: 0, heading: 0, pitch: 0, roll: 0, look: new Uint8Array(8) };
}

const scratchLook = blankLook();

/** `own` written from a frame of the cockpit's flight: its state, its gear, whether it is paused or warped, and its airframe. */
export function writeOwn(
  own: OwnState, telemetry: Pick<Telemetry, "state" | "gear">, status: { paused: boolean; warp: boolean }, airframe: Readonly<Damage>,
): OwnState {
  const { state } = telemetry;
  const warp = status.warp ? WARP_FACTOR : 1;
  const along = state.tas * Math.cos(state.flightPath * RADIANS) * warp;
  own.flags = (state.onGround ? ON_GROUND : 0) | (telemetry.gear > 0.5 ? GEAR_DOWN : 0) | (status.paused ? PAUSED : 0) | (warp > 1 ? WARPED : 0);
  own.lon = state.lon;
  own.lat = state.lat;
  own.altitude = state.altitude;
  own.east = status.paused ? 0 : along * Math.sin(state.track * RADIANS);
  own.north = status.paused ? 0 : along * Math.cos(state.track * RADIANS);
  own.up = status.paused ? 0 : state.tas * Math.sin(state.flightPath * RADIANS) * warp;
  own.heading = state.heading;
  own.pitch = state.pitch;
  own.roll = state.roll;
  encodeLook(lookOf(state, airframe, scratchLook), own.look);
  return own;
}
