/**
 * Where the flight deck's stick, levers, pedals and handles stand, as the
 * pilot puts them: what the frame draws them at (`CockpitPose`, model.ts).
 *
 * Each follows what moves it, and none follows what the aircraft does on
 * its own, as on an A320: the sidestick is where the hand holds it (the
 * keys, a gamepad, a finger, the mouse on it) and springs back upright when
 * let go, the autopilot flying or not; the pedals are where the feet put
 * them; the thrust levers are where they were set, and stay there while
 * alpha floor takes the engines to full thrust without them. The flap
 * lever, the gear's and the speed brake's go to where they are put at
 * once, whatever the flaps, the gear and the spoilers are doing meanwhile.
 *
 * And each takes a moment to get there: a key is all or nothing, and a
 * lever thrown is not in its new notch the instant it is thrown.
 */
import type { CockpitPose } from "./model";

/** What puts the flight deck's controls where they are, this frame. */
export interface LeverInputs {
  /** The stick and the pedals as asked, -1 to 1 each, with the flight's own signs: nose up, right wing down, nose right. */
  pitch: number;
  roll: number;
  yaw: number;
  /** The rudder trim's knob as a hand holds it turned, -1 to 1; 0 let go. */
  trim: number;
  /** The throttle, 0 (idle) to 1 (full thrust), and how far the reversers are open, 0 to 1. */
  throttle: number;
  reverse: number;
  /** Alpha floor is giving the engines full thrust, which it does without the levers. */
  alphaFloor: boolean;
  /** Where the flap lever is put, 0 to 4. */
  flapLever: number;
  /** Whether the gear's lever is down, the speed brake's pulled, and the parking brake set. */
  gearDown: boolean;
  speedBrake: boolean;
  parkingBrake: boolean;
}

/** Every one of the flight deck's controls, said. */
export type Levers = Required<CockpitPose>;

/** As the model has them: upright, idle, flaps 0, gear up, retracted, level, off. */
export const LEVERS_AT_REST: Levers = {
  stickPitch: 0, stickRoll: 0, thrust: 0, flapLever: 0, speedBrake: 0, groundSpoilersArmed: 0, gearLever: 0, pedals: 0,
  parkingBrake: 0, rudderTrim: 0,
};

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Where the controls are put, from what puts them there (`before`: where
 * they stand now, which the thrust levers keep under alpha floor). With
 * the gear's lever down and the speed brake's in, the ground spoilers are
 * armed: its lever is pulled up in its notch, as a crew does it for a
 * landing.
 */
export function leverTargets(inputs: LeverInputs, before: Levers = LEVERS_AT_REST): Levers {
  const thrust = clamp(inputs.throttle, 0, 1) - clamp(inputs.reverse, 0, 1);
  return {
    stickPitch: clamp(inputs.pitch, -1, 1),
    stickRoll: clamp(inputs.roll, -1, 1),
    thrust: inputs.alphaFloor ? before.thrust : thrust,
    flapLever: clamp(inputs.flapLever, 0, 4),
    speedBrake: inputs.speedBrake ? 1 : 0,
    groundSpoilersArmed: inputs.gearDown && !inputs.speedBrake ? 1 : 0,
    gearLever: inputs.gearDown ? 1 : 0,
    pedals: clamp(inputs.yaw, -1, 1),
    parkingBrake: inputs.parkingBrake ? 1 : 0,
    rudderTrim: clamp(inputs.trim, -1, 1),
  };
}

/**
 * How each control goes where it is put. What a hand or a foot holds
 * follows it closely, a moment behind (seconds: how long it takes to get
 * most of the way); what is thrown from notch to notch goes at a pace
 * (its travel a second).
 */
const FOLLOWS_S: Partial<Record<keyof Levers, number>> = { stickPitch: 0.08, stickRoll: 0.08, pedals: 0.1, rudderTrim: 0.1, thrust: 0.12 };
const THROWN_PER_S: Partial<Record<keyof Levers, number>> = {
  flapLever: 5, speedBrake: 4, groundSpoilersArmed: 6, gearLever: 3, parkingBrake: 3,
};

/** The controls a frame of `dt` seconds on from `from`, on their way to `to`. */
export function easeLevers(from: Levers, to: Levers, dt: number): Levers {
  const next = { ...from };
  for (const name of Object.keys(to) as Array<keyof Levers>) {
    const lag = FOLLOWS_S[name];
    if (lag !== undefined) {
      next[name] = from[name] + (to[name] - from[name]) * (1 - Math.exp(-Math.max(dt, 0) / lag));
      continue;
    }
    const step = (THROWN_PER_S[name] ?? Infinity) * Math.max(dt, 0);
    next[name] = from[name] + clamp(to[name] - from[name], -step, step);
  }
  return next;
}
