/**
 * How the aircraft flies: an airliner-class twin, with about the numbers of
 * an A320 at 65 tonnes.
 *
 * The forces are real ones, summed on a point mass: the wing's lift from its
 * angle of attack, flaps and spoilers; drag from the airframe, the lift, the
 * flaps, the gear, the spoilers and the speed of sound; the engines' thrust,
 * which thins with the air and falls off with speed; and weight. They bend
 * the flight path and change the speed. On the ground the wheels carry what
 * the wing does not, roll, brake and steer.
 *
 * The attitude is not left to moments and inertias. It is flown as an
 * airliner's fly-by-wire flies it, which is also what a keyboard flies well:
 * the stick asks for a load factor, and let go the aircraft holds its flight
 * path, trimming itself as the speed changes; in a turn of up to 33 degrees
 * it pulls for itself. It will not be pulled into a stall (the angle of
 * attack stops short of it, and near it the engines go to full thrust on
 * their own), nor banked past 67 degrees, nor pitched past 30 up and 15
 * down. Close to the ground with the gear down the stick moves the nose
 * directly, to flare with. A stall is still there for rough air, ice and a
 * low, slow wing to find.
 *
 * Everything is SI (metres, seconds, m/s, newtons) and angles are degrees:
 * heading clockwise from north, pitch nose up and roll right wing down
 * positive. The altitude is true, above sea level, as the instruments show
 * it; the map draws the world taller than life, which is the camera's
 * concern.
 *
 * Deterministic: the turbulence comes in from outside as a gust, so the same
 * inputs always fly the same path, which is what the tests rely on.
 */
import { density, indicatedFromTrue, machOf, SEA_LEVEL_DENSITY } from "./atmosphere";
import { destination, wrap360 } from "./geo";

export const G = 9.80665;

const MASS_KG = 65_000;
const WING_M2 = 122.6;
const SPAN_M = 34.1;
const WEIGHT_N = MASS_KG * G;

/** Lift, clean: at zero angle of attack, and per degree of it. */
const CL_ZERO = 0.25;
const CL_PER_DEG = 0.087;
/** Past the stall the lift falls away by this much a degree, down to this share of its most. */
const CL_STALL_DROP = 0.06;
const CL_STALLED_LEAST = 0.6;
/** How far short of the stall a stalled wing has to come to fly again, degrees. */
const STALL_RECOVERY = 3;
/** As far as the angle of attack is taken. */
const MAX_ALPHA = 40;
const MIN_ALPHA = -10;

/**
 * The flap lever's five places, as an A320 names them, and what the wing is
 * at each: the lift the flaps add at any angle of attack, the angle it
 * stalls at (the slats put that off), the drag they cost, and the fastest
 * the aircraft may fly with them out, m/s indicated.
 */
export const FLAP_NAMES = ["0", "1", "2", "3", "FULL"] as const;
export const FLAPS_MOST = FLAP_NAMES.length - 1;
const FLAP_LIFT = [0, 0.42, 0.55, 0.72, 1.0];
const FLAP_STALL_ALPHA = [15, 18.2, 18.4, 18.7, 19];
const FLAP_DRAG = [0, 0.012, 0.026, 0.042, 0.075];
export const FLAP_LIMIT_MS = [Infinity, 110.6, 102.9, 95.2, 91.1];
/** How long the flaps take from one place to the next, seconds. */
export const FLAP_NOTCH_S = 5;

/** Clean, the wing stalls sooner the nearer the speed of sound: by this share at the Mach number where it has stopped falling. */
const MACH_STALL_FROM = 0.3;
const MACH_STALL_SPAN = 0.55;
const MACH_STALL_LOSS = 0.61;

/** Drag: the airframe's own, and the lift's (1 / (pi AR e) for a wing of aspect ratio 9.5). */
const CD_ZERO = 0.022;
const CD_INDUCED = 0.045;
/** A stalled wing's, a degree past the stall, and the most of it. */
const CD_STALL_PER_DEG = 0.02;
const CD_STALL_MOST = 0.25;
/** The landing gear down. */
export const CD_GEAR = 0.02;
/** How long the gear takes to go all the way up or down, seconds. */
export const GEAR_S = 7;
/** The fastest the gear may be down at, m/s indicated (280 kt). */
export const GEAR_LIMIT_MS = 144;

/**
 * The spoilers, 0 flat to 1 all the way up. In the air the speed brake
 * raises them half way; on the ground they all stand up on touchdown, which
 * is what puts the weight on the wheels. They cost lift by the square of how
 * far they are up, and add drag.
 */
export const SPEEDBRAKE = 0.5;
const SPOILER_LIFT_LOSS = 0.7;
const SPOILER_DRAG = [0.06, 0.03];
/** How long they take all the way, seconds. */
const SPOILER_S = 1.4;

/**
 * Where the drag starts to climb with Mach number: by the fourth power of
 * what the speed is past it, which by Mach 0.9 is more than full thrust
 * pushes through.
 */
const MACH_CRITICAL = 0.68;
const WAVE_DRAG = 20;
/** Past this, the overspeed warning: an airliner's maximum operating Mach, and its indicated limit (350 kt). */
export const MMO = 0.82;
export const VMO_MS = 180;

/**
 * Both engines' thrust standing still at sea level, newtons. It thins with
 * the air (by its density to the power below) and falls off with speed, as
 * a fan's does: by a sixth at take-off speed, and to under a quarter at a
 * cruise seven miles up.
 */
const THRUST_STATIC_N = 240_000;
const THRUST_LAPSE = 0.75;
const THRUST_MACH = [0.9, 0.45];
/** What the engines give at idle, as a share of full. */
const IDLE = 0.05;
/** How long the engines take to follow the throttle: from high power, and that much longer from idle, seconds. */
const SPOOL_S = 0.9;
const SPOOL_SLOW_S = 2.2;
/** How fast W and S move the throttle, a share a second. */
const THROTTLE_PER_S = 0.35;
/** The reversers: how long they take to open, what the engines run at behind them, and the share of that thrust they turn back. */
const REVERSE_S = 1.2;
const REVERSE_POWER = 0.7;
const REVERSE_SHARE = 0.45;
/** Below this they close again, m/s: slower, an engine breathes its own exhaust. */
const REVERSE_LEAST_MS = 18;

/** A full roll input, degrees a second; how long the roll rate takes to follow it, seconds. */
export const ROLL_RATE = 15;
const ROLL_LAG_S = 0.3;
/** The bank the controls stop at, and the one the aircraft rolls back to when let go past it. */
export const BANK_LIMIT = 67;
export const BANK_HOLD = 33;
const BANK_RETURN_RATE = 6;
/** The rudder's yaw in the air, degrees a second, and the roll it brings with it. */
const YAW_RATE = 3;
const YAW_ROLL = 2;

/**
 * The stick, fully back and fully forward, in g: what it asks for is this
 * less the more of it the speed turns into pitch rate (an airliner's C*,
 * which blends the two round `C_STAR_MS`), so a pull is about as brisk a
 * pitch slow as fast.
 */
const STICK_UP_G = 1.6;
const STICK_DOWN_G = 1.1;
const C_STAR_MS = 120;
/** The load factors the controls stop at: clean, and with the flaps out. */
export const LOAD_LIMITS = { clean: [-1, 2.5], flaps: [0, 2] } as const;
/** The pitch the controls stop at, nose up and nose down. */
export const PITCH_UP_LIMIT = 30;
export const PITCH_DOWN_LIMIT = -15;
/** How fast the nose follows what is asked of it, a second; the fastest it moves, degrees a second, and its lag. */
const PITCH_GAIN = 2;
export const PITCH_RATE = 6;
const PITCH_LAG_S = 0.25;
/** The dynamic pressure at which the elevator has all of its say, pascals. */
const Q_REFERENCE_PA = 5000;
/**
 * The angle of attack is kept this far short of the stall with the stick
 * let go, and this far with it fully back; this far short, the engines go
 * to full thrust on their own.
 */
const ALPHA_PROTECTED = 3.5;
const ALPHA_MOST = 1;
const ALPHA_FLOOR = 2.5;
/** Not below this over the ground, metres: there it is a landing. Nor faster than this Mach number, where it is the speed that brings the stall near. */
const ALPHA_FLOOR_ABOVE_M = 30;
const ALPHA_FLOOR_MACH = 0.53;
/** How fast the nose is moved ahead of a wanted angle of attack that is itself moving, degrees a second at most. */
const ALPHA_LEAD = 2;
/** A stalled wing drops the nose this fast for each degree past the stall, degrees a second. */
const STALL_NOSE_DROP = 1.5;
/** The autopilot's climb and descent, m/s, and how fast it bends the path to it, seconds. */
const AUTOPILOT_CLIMB_MS = 12;
const AUTOPILOT_PATH_S = 3;

/** Below this over the ground with the gear down, metres, the stick moves the nose itself: the flare. */
export const FLARE_M = 15;
/** There the nose sinks by this much on its own, degrees a second, so a flare has to be flown. */
const FLARE_NOSE_DOWN = 0.3;
const FLARE_PITCH_RATE = 4;

/**
 * The ground. The wheels roll with this much of what they carry against
 * them, and brake with up to this much; the brakes that come on by
 * themselves after a landing slow it by this much, m/s a second. On the
 * ground the nose comes up no further than the tail allows, and the nose
 * wheel steers at up to this rate, degrees a second, or as hard a turn as
 * this many g.
 */
const ROLLING = 0.02;
const BRAKING = 0.5;
export const AUTOBRAKE_MS2 = 3;
export const TAIL_STRIKE = 11.5;
const ROTATION_RATE = 3.5;
const NOSE_FALLS = 2.5;
const STEERING_RATE = 14;
const STEERING_G = 0.25;
/** The throttle from which a landed aircraft may fly again: a go-around, not a bounce. */
const GO_AROUND = 0.3;
/** It leaves the ground with this much more lift than weight, and a wheel brushing it again under power this gently, m/s, is no landing. */
const LIFT_OFF = 1.02;
const BRUSH_MS = 0.5;
/** The dynamic pressure at which the elevator can lift the nose off the ground, pascals: about 110 kt. */
const Q_ROTATION_PA = 2000;

/**
 * What a touchdown has to be to be a landing: on the wheels, no harder than
 * this (m/s; a firm one is half of it), wings and nose within these, no
 * faster than the tyres bear, and on ground no steeper than this (a rise
 * over its run).
 */
export const LANDING_LIMITS = { sink: 6, firm: 3, roll: 8, pitch: [-1.5, 12.5], speed: 110, slope: 0.12 } as const;

/** What the gear feels of a touchdown, g for each m/s it came down at. */
const TOUCHDOWN_G = 0.4;

/** The slowest the aircraft is taken to fly at, m/s: slower, it only falls. */
const MIN_FLYING_MS = 25;
/** The longest a step may be: a frame stalled for a second is flown as 50 ms, not as a lurch. */
export const MAX_DT = 0.05;

/** Why a flight ended on the ground and not on its wheels. */
export type Crash = "terrain" | "gear" | "hard" | "attitude" | "fast";

/** A touchdown, as it was: how hard (m/s down), how fast, the attitude, and what the gear felt, g. */
export interface Touchdown {
  sink: number;
  tas: number;
  pitch: number;
  roll: number;
  load: number;
}

export interface AircraftState {
  lon: number;
  lat: number;
  /** True metres above sea level. */
  altitude: number;
  heading: number;
  pitch: number;
  roll: number;
  /** True airspeed, m/s. */
  tas: number;
  /** Where the flight path points, degrees above the horizon. */
  flightPath: number;
  /** Where the throttle is, 0 to 1, and what the engines give of it so far. */
  throttle: number;
  spool: number;
  /** How far the reversers are open, 0 to 1. */
  reverse: number;
  /** The attitude rates the controls have reached, degrees a second. */
  rollRate: number;
  pitchRate: number;
  /** Where the flaps are, in the lever's places (0 to `FLAPS_MOST`), on their way between; the spoilers, 0 to 1. */
  flaps: number;
  spoilers: number;
  /** How much of the air's rise and fall the aircraft has been taken along by, m/s. */
  airUp: number;
  /** The angle of attack the controls last wanted, degrees: what the nose is moved ahead of. */
  alphaWanted: number;
  /** Standing or rolling on its wheels; and whether the brakes that come on after a landing are on. */
  onGround: boolean;
  autobrake: boolean;
  /** The last touchdown, until it flies again; and why the flight ended, where it did. */
  touchdown: Touchdown | null;
  crash: Crash | null;
  /** What follows from the rest: m/s, degrees, g; whether the wing has stalled, and whether the engines are held at full thrust for it. */
  verticalSpeed: number;
  alpha: number;
  loadFactor: number;
  stalled: boolean;
  alphaFloor: boolean;
}

/** The stick, the rudder and the throttle lever, each -1 to 1. */
export interface ControlInput {
  /** Nose up positive. */
  pitch: number;
  /** Right wing down positive. */
  roll: number;
  /** Nose right positive. */
  yaw: number;
  /** Throttle up positive: how fast the lever moves, not where it is. Pulled back at idle on the ground, the reversers. */
  throttle: number;
  /** While held: the speed brake in the air, the wheel brakes on the ground. */
  brake: boolean;
}

export const NO_INPUT: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };

/** A gust: degrees a second of roll and pitch, and the air's own rise, m/s. */
export interface Gust {
  roll: number;
  pitch: number;
  vertical: number;
}

export const CALM: Gust = { roll: 0, pitch: 0, vertical: 0 };

export interface Environment {
  /** How many times the ground distance a step covers, for the long approach; the attitude stays real time. */
  warp: number;
  gust: Gust;
  /** The altitude the autopilot holds, wings level; null with it off. */
  autopilot: number | null;
  /** How far the landing gear is down, 0 up to 1 down; up where not said. */
  gear?: number;
  /** Where the flap lever is, 0 to `FLAPS_MOST`; and whether the speed brake's is pulled. */
  flapLever?: number;
  speedbrake?: boolean;
  /** How high the aircraft stands with its wheels on the ground here, metres above sea level; none where not known. */
  ground?: number | null;
  /** How steeply that ground rises ahead, a rise over its run. */
  slope?: number;
  /** Ice on the wing, 0 to 1: it stalls sooner, and drags. */
  ice?: number;
}

export const STILL_AIR: Environment = { warp: 1, gust: CALM, autopilot: null };

const RADIANS = Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
/** How far a first-order lag of time constant `tau` closes in `dt`. */
const lag = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
/** A value towards another, by no more than a step. */
const towards = (value: number, target: number, most: number) => value + clamp(target - value, -most, most);

/** One of the flaps' numbers where they are between two of the lever's places. */
function between(table: readonly number[], flaps: number): number {
  const at = clamp(flaps, 0, FLAPS_MOST);
  const low = Math.min(Math.floor(at), FLAPS_MOST - 1);
  return table[low] + (table[low + 1] - table[low]) * (at - low);
}

/** The wing as it is set: what makes its lift and drag at any angle of attack. */
interface Wing {
  /** The lift at zero angle of attack, the angle it stalls at, and the share of its lift the spoilers leave it. */
  liftZero: number;
  stallAlpha: number;
  kept: number;
  /** The drag of what hangs out of it and off it. */
  drag: number;
}

function wingOf(flaps: number, spoilers: number, gear: number, mach: number, ice: number): Wing {
  const shut = clamp((mach - MACH_STALL_FROM) / MACH_STALL_SPAN, 0, 1) * MACH_STALL_LOSS;
  return {
    liftZero: CL_ZERO + between(FLAP_LIFT, flaps),
    // Ice roughens the wing: it stalls a fifth sooner under all of it.
    stallAlpha: between(FLAP_STALL_ALPHA, flaps) * (1 - shut) * (1 - 0.2 * ice),
    kept: 1 - SPOILER_LIFT_LOSS * spoilers * spoilers,
    drag: between(FLAP_DRAG, flaps) + CD_GEAR * gear + SPOILER_DRAG[0] * spoilers + SPOILER_DRAG[1] * spoilers * spoilers
      + CD_ZERO * 0.4 * ice,
  };
}

/** The lift coefficient at an angle of attack: up its slope to the stall, and falling away past it. */
function liftAt(wing: Wing, alpha: number): number {
  const most = wing.liftZero + CL_PER_DEG * wing.stallAlpha;
  const attached = alpha <= wing.stallAlpha
    ? wing.liftZero + CL_PER_DEG * alpha
    : Math.max(most - CL_STALL_DROP * (alpha - wing.stallAlpha), most * CL_STALLED_LEAST);
  return attached * wing.kept;
}

/** The angle of attack that makes a lift coefficient, on the slope, degrees. */
const alphaFor = (wing: Wing, cl: number) => (cl / wing.kept - wing.liftZero) / CL_PER_DEG;

/** The dynamic pressure, pascals. */
export const dynamicPressure = (altitude: number, tas: number): number => 0.5 * density(altitude) * tas * tas;

/** The lift coefficient a load factor needs at a dynamic pressure. */
const liftNeeded = (load: number, q: number) => (load * WEIGHT_N) / (Math.max(q, 1) * WING_M2);

/** The drag coefficient's rise with Mach number. */
const waveDrag = (mach: number) => WAVE_DRAG * Math.max(0, mach - MACH_CRITICAL) ** 4;

/**
 * How much of the lift's drag is left this high over the ground, 0 to 1:
 * within a wingspan of it the ground gets in the way of the wing's wake.
 */
function groundEffect(height: number): number {
  if (!Number.isFinite(height)) return 1;
  const ratio = (16 * Math.max(height, 0)) / SPAN_M;
  return (ratio * ratio) / (1 + ratio * ratio);
}
/** How high the wing is over the ground with the wheels on it, metres. */
const WING_OVER_WHEELS_M = 3.4;

/** Full thrust at a height and speed, newtons. */
export function thrustAt(altitude: number, tas: number): number {
  const mach = machOf(tas, altitude);
  return THRUST_STATIC_N * (density(altitude) / SEA_LEVEL_DENSITY) ** THRUST_LAPSE
    * (1 - THRUST_MACH[0] * mach + THRUST_MACH[1] * mach * mach);
}

/** How an aircraft is set for a steady flight: flaps and gear, and the path it holds, degrees above the horizon. */
export interface Trim {
  flaps?: number;
  gear?: number;
  path?: number;
}

/**
 * The angle of attack and the throttle that hold a true airspeed steady at
 * a height, along a path: degrees, and 0 to 1 (1 where full thrust does not
 * hold it, 0 where idle is already too much).
 */
export function trimFor(altitude: number, tas: number, { flaps = 0, gear = 0, path = 0 }: Trim = {}): { alpha: number; throttle: number } {
  const q = dynamicPressure(altitude, tas);
  const mach = machOf(tas, altitude);
  const wing = wingOf(flaps, 0, gear, mach, 0);
  const full = thrustAt(altitude, tas);
  const along = WEIGHT_N * Math.sin(path * RADIANS);
  let alpha = alphaFor(wing, liftNeeded(Math.cos(path * RADIANS), q));
  let thrust = 0;
  // The thrust carries a little of the weight itself, which the wing then need not: twice round is enough.
  for (let round = 0; round < 3; round++) {
    const cl = liftAt(wing, alpha);
    thrust = clamp(q * WING_M2 * (CD_ZERO + wing.drag + CD_INDUCED * cl * cl + waveDrag(mach)) + along, IDLE * full, full);
    alpha = alphaFor(wing, liftNeeded(Math.cos(path * RADIANS) - (thrust * Math.sin(alpha * RADIANS)) / WEIGHT_N, q));
  }
  return { alpha, throttle: thrust <= IDLE * full ? 0 : thrust / full };
}

/** The throttle that holds a true airspeed level at a height, clean, 0 to 1 (1 where full thrust does not). */
export const trimThrottle = (altitude: number, tas: number): number => trimFor(altitude, tas).throttle;

/** The angle of attack level flight takes at a height and speed, clean, degrees. */
export const levelAlpha = (altitude: number, tas: number): number => trimFor(altitude, tas).alpha;

/**
 * The speeds a configuration flies by, m/s indicated: the one the wing
 * stalls at in level flight, the lowest that is flown (a quarter over it,
 * and the usual one down an approach), and the fastest the flaps and the
 * gear as they are set allow.
 */
export function speedsFor(flaps: number, spoilers = 0, gear = 0): { stall: number; lowest: number; limit: number } {
  const wing = wingOf(flaps, spoilers, 0, 0, 0);
  const most = liftAt(wing, wing.stallAlpha);
  const stall = Math.sqrt((2 * WEIGHT_N) / (SEA_LEVEL_DENSITY * WING_M2 * most));
  const notch = Math.min(Math.ceil(clamp(flaps, 0, FLAPS_MOST) - 1e-6), FLAPS_MOST);
  return { stall, lowest: stall * 1.23, limit: Math.min(FLAP_LIMIT_MS[notch], gear > 0 ? GEAR_LIMIT_MS : Infinity, VMO_MS) };
}

const DERIVED = {
  reverse: 0, rollRate: 0, pitchRate: 0, spoilers: 0, airUp: 0, autobrake: false, touchdown: null, crash: null,
  stalled: false, alphaFloor: false,
} as const;

/**
 * An aircraft in steady flight, trimmed: level and clean where not said
 * otherwise, which is what the flight starts with.
 */
export function levelFlight(
  lon: number, lat: number, altitude: number, heading: number, tas: number, trim: Trim = {},
): AircraftState {
  const { alpha, throttle } = trimFor(altitude, tas, trim);
  const path = trim.path ?? 0;
  return {
    ...DERIVED, lon, lat, altitude, heading: wrap360(heading), pitch: path + alpha, roll: 0, tas, flightPath: path, throttle,
    spool: Math.max(throttle, IDLE), flaps: trim.flaps ?? 0, onGround: false, verticalSpeed: tas * Math.sin(path * RADIANS), alpha,
    alphaWanted: alpha, loadFactor: Math.cos(path * RADIANS),
  };
}

/** An aircraft standing on its wheels, engines at idle, flaps set for take-off: `ground` is how high it stands. */
export function parked(lon: number, lat: number, ground: number, heading: number): AircraftState {
  return {
    ...DERIVED, lon, lat, altitude: ground, heading: wrap360(heading), pitch: 0, roll: 0, tas: 0, flightPath: 0, throttle: 0, spool: IDLE,
    flaps: 1, onGround: true, verticalSpeed: 0, alpha: 0, alphaWanted: 0, loadFactor: 1,
  };
}

/** The roll rate the controls ask for, degrees a second. */
function rollDemand(state: AircraftState, input: ControlInput, autopilot: boolean): number {
  const { roll } = state;
  if (autopilot) return clamp(-roll * 0.6, -8, 8);
  let demand: number;
  if (input.roll !== 0) {
    // Towards the bank limit the stick rolls ever slower, and no further; past it, back.
    const further = Math.sign(input.roll) === Math.sign(roll);
    const room = further ? clamp((BANK_LIMIT - Math.abs(roll)) * 2, -ROLL_RATE, ROLL_RATE) : ROLL_RATE;
    demand = input.roll * room;
  } else if (Math.abs(roll) > BANK_HOLD) {
    // Let go steeper than a normal turn, it rolls back to one.
    demand = -Math.sign(roll) * Math.min(BANK_RETURN_RATE, (Math.abs(roll) - BANK_HOLD) * 1.5);
  } else {
    demand = 0;
  }
  return demand + input.yaw * YAW_ROLL;
}

/** What the engines and the surfaces that move at their own pace are, a step on. */
function machinery(state: AircraftState, input: ControlInput, h: number, env: Environment, floor: boolean) {
  let throttle = clamp(state.throttle + input.throttle * THROTTLE_PER_S * h, 0, 1);
  // Held at full thrust for the angle of attack, until the lever is moved again.
  if (floor) throttle = 1;
  // The reversers: on the ground, the lever pulled back at idle, and not below the speed they are any use at.
  const reversing = state.onGround && throttle <= 0 && input.throttle < 0 && state.tas > REVERSE_LEAST_MS;
  const reverse = towards(state.reverse, reversing ? 1 : 0, h / REVERSE_S);
  const wanted = Math.max(reverse > 0 ? REVERSE_POWER * reverse : 0, throttle, IDLE);
  // An engine at idle takes its time to wake up; one already running hard follows at once.
  const spool = state.spool + (wanted - state.spool) * lag(h, SPOOL_S + SPOOL_SLOW_S * (1 - state.spool) ** 2);
  const flaps = towards(state.flaps, clamp(Math.round(env.flapLever ?? state.flaps), 0, FLAPS_MOST), h / FLAP_NOTCH_S);
  // After a landing, at idle, every spoiler stands up; in the air the speed brake's do, though not with the flaps all the way out.
  const brake = (env.speedbrake || input.brake) && flaps < FLAPS_MOST - 0.5 && !floor;
  const dumping = state.touchdown !== null && throttle < 0.15 && state.tas > 5;
  const spoilers = towards(state.spoilers, state.onGround ? (dumping ? 1 : 0) : brake ? SPEEDBRAKE : 0, h / SPOILER_S);
  return { throttle, reverse, spool, flaps, spoilers };
}

/** Why a touchdown is not a landing, or null where it is one. */
function crashOf(state: AircraftState, sink: number, env: Environment): Crash | null {
  if ((env.gear ?? 0) < 0.99) return "gear";
  if (Math.abs(env.slope ?? 0) > LANDING_LIMITS.slope) return "terrain";
  if (sink > LANDING_LIMITS.sink) return "hard";
  if (Math.abs(state.roll) > LANDING_LIMITS.roll || state.pitch < LANDING_LIMITS.pitch[0] || state.pitch > LANDING_LIMITS.pitch[1]) {
    return "attitude";
  }
  if (state.tas > LANDING_LIMITS.speed) return "fast";
  return null;
}

/** Advance the aircraft `dt` seconds (at most `MAX_DT`). One that has crashed stays as it is. */
export function step(state: AircraftState, input: ControlInput, dt: number, env: Environment = STILL_AIR): AircraftState {
  const h = clamp(dt, 0, MAX_DT);
  if (h === 0 || state.crash) return state;
  return state.onGround ? roll(state, input, h, env) : fly(state, input, h, env);
}

/** A step in the air. */
function fly(state: AircraftState, input: ControlInput, h: number, env: Environment): AircraftState {
  const autopilot = env.autopilot !== null;
  const gear = env.gear ?? 0;
  const ground = env.ground ?? null;
  const over = ground === null ? Infinity : state.altitude - ground;
  const speed = Math.max(state.tas, MIN_FLYING_MS);
  const q = dynamicPressure(state.altitude, speed);
  const mach = machOf(speed, state.altitude);

  // Near the stall the engines go to full thrust on their own, and stay there until the lever is moved.
  const before = wingOf(state.flaps, state.spoilers, gear, mach, env.ice ?? 0);
  const floor = over > ALPHA_FLOOR_ABOVE_M && !state.stalled
    && ((mach < ALPHA_FLOOR_MACH && state.alpha > before.stallAlpha - ALPHA_FLOOR) || (state.alphaFloor && input.throttle === 0));
  const { throttle, reverse, spool, flaps, spoilers } = machinery(state, input, h, env, floor);
  const wing = wingOf(flaps, spoilers, gear, mach, env.ice ?? 0);

  // The air's own rise takes the aircraft along after a moment; until it has, it is a change in the angle of attack.
  const airUp = state.airUp + (env.gust.vertical - state.airUp) * lag(h, 1.5);
  const gustAlpha = Math.atan2(env.gust.vertical - airUp, speed) / RADIANS;

  // The wing meets the air at the angle between the nose and the flight path, as the bank shares it out.
  const banked = Math.cos(clamp(Math.abs(state.roll), 0, 75) * RADIANS);
  const alpha = clamp((state.pitch - state.flightPath) / banked + gustAlpha, MIN_ALPHA, MAX_ALPHA);
  const stalled = state.stalled ? alpha > wing.stallAlpha - STALL_RECOVERY : alpha > wing.stallAlpha;

  // The forces.
  const cl = liftAt(wing, alpha);
  const induced = CD_INDUCED * cl * cl * groundEffect(over + WING_OVER_WHEELS_M);
  const stallDrag = clamp((alpha - wing.stallAlpha) * CD_STALL_PER_DEG, 0, CD_STALL_MOST);
  const drag = q * WING_M2 * (CD_ZERO + wing.drag + induced + waveDrag(mach) + stallDrag);
  const thrust = thrustAt(state.altitude, speed) * Math.max(spool, IDLE);
  const loadFactor = (q * WING_M2 * cl + thrust * Math.sin(alpha * RADIANS)) / WEIGHT_N;
  const path = state.flightPath * RADIANS;
  const bank = state.roll * RADIANS;
  const accel = (thrust * Math.cos(alpha * RADIANS) - drag) / MASS_KG - G * Math.sin(path);
  const pathRate = ((G / speed) * (loadFactor * Math.cos(bank) - Math.cos(path))) / RADIANS;

  // The load factor asked for: level, a turn's own up to a normal bank, and what the stick adds.
  const limits = flaps > 0.5 ? LOAD_LIMITS.flaps : LOAD_LIMITS.clean;
  const turning = Math.cos(path) / Math.cos(Math.min(Math.abs(state.roll), BANK_HOLD) * RADIANS);
  let pitchDemand: number;
  let alphaWanted = alpha;
  if (!autopilot && gear > 0.5 && over < FLARE_M) {
    // The flare: the stick is the nose's own rate, and the nose sinks a little if it is not held.
    const authority = clamp(q / Q_REFERENCE_PA, 0.3, 1.2);
    pitchDemand = input.pitch * FLARE_PITCH_RATE * authority - (input.pitch === 0 ? FLARE_NOSE_DOWN : 0)
      // And still not into a stall.
      - Math.max(0, alpha - (wing.stallAlpha - ALPHA_MOST)) * PITCH_GAIN;
  } else {
    let asked: number;
    if (autopilot) {
      const climb = clamp((env.autopilot! - state.altitude) * 0.08, -AUTOPILOT_CLIMB_MS, AUTOPILOT_CLIMB_MS);
      const wantedPath = Math.asin(clamp(climb / speed, -0.3, 0.3));
      asked = Math.cos(path) + clamp((speed * (wantedPath - path)) / (G * AUTOPILOT_PATH_S), -0.3, 0.3);
    } else {
      const stick = input.pitch > 0 ? input.pitch * STICK_UP_G : input.pitch * STICK_DOWN_G;
      asked = turning + stick / (1 + C_STAR_MS / speed);
      // The nose stops at its limits: the pull, or the push, runs out as it nears them.
      asked = Math.min(asked, turning + (PITCH_UP_LIMIT - state.pitch) * 0.12);
      asked = Math.max(asked, turning - (state.pitch - PITCH_DOWN_LIMIT) * 0.12);
    }
    asked = clamp(asked, limits[0], limits[1]);
    // Not into a stall: with the stick let go the wing stays well short of it, fully back just short.
    const most = wing.stallAlpha - ALPHA_PROTECTED + Math.max(0, autopilot ? 0 : input.pitch) * (ALPHA_PROTECTED - ALPHA_MOST);
    // What the thrust carries of the weight, tilted up as it is, the wing need not.
    alphaWanted = Math.min(alphaFor(wing, liftNeeded(asked - (thrust * Math.sin(alpha * RADIANS)) / WEIGHT_N, q)), most);
    const authority = clamp(q / Q_REFERENCE_PA, 0.3, 1.3);
    // Towards it, along with the flight path as it bends, and ahead of it as it moves: slowing down, it only ever grows.
    const lead = clamp((alphaWanted - state.alphaWanted) / h, -ALPHA_LEAD, ALPHA_LEAD);
    pitchDemand = clamp(
      (state.flightPath + alphaWanted * banked - state.pitch) * PITCH_GAIN + pathRate + lead * banked,
      -PITCH_RATE * authority, PITCH_RATE * authority,
    );
  }
  // A stalled wing drops the nose, whatever is asked of it.
  if (stalled) pitchDemand = Math.min(pitchDemand, -(alpha - (wing.stallAlpha - ALPHA_PROTECTED)) * STALL_NOSE_DROP);

  const rollRate = state.rollRate + (rollDemand(state, input, autopilot) - state.rollRate) * lag(h, ROLL_LAG_S);
  const pitchRate = state.pitchRate + (pitchDemand - state.pitchRate) * lag(h, PITCH_LAG_S);
  const rolled = clamp(state.roll + (rollRate + env.gust.roll) * h, -85, 85);
  const pitch = clamp(state.pitch + (pitchRate + env.gust.pitch) * h, -60, 60);

  // The lift's sideways share turns the flight; the rudder a little more.
  const yaw = autopilot ? 0 : input.yaw;
  const headingRate = (G * loadFactor * Math.sin(bank)) / (speed * Math.max(Math.cos(path), 0.2)) / RADIANS + yaw * YAW_RATE;
  const heading = wrap360(state.heading + headingRate * h);
  const flightPath = clamp(state.flightPath + pathRate * h, -85, 85);
  const tas = Math.max(state.tas + accel * h, MIN_FLYING_MS);

  const verticalSpeed = tas * Math.sin(flightPath * RADIANS) + airUp;
  const altitude = state.altitude + verticalSpeed * h;
  const travelled = tas * Math.cos(flightPath * RADIANS) * h * env.warp;
  const [lon, lat] = destination(state.lon, state.lat, heading, travelled);

  const flown: AircraftState = {
    lon, lat, altitude, heading, pitch, roll: rolled, tas, flightPath, throttle, spool, reverse, rollRate, pitchRate, flaps, spoilers,
    airUp, alphaWanted, onGround: false, autobrake: false, touchdown: null, crash: null, verticalSpeed, alpha, loadFactor, stalled,
    alphaFloor: floor,
  };
  if (ground === null || altitude > ground) return flown;

  // The ground: a landing, where it is one.
  const sink = Math.max(0, -verticalSpeed);
  const crash = crashOf(flown, sink, env);
  // Still taking off, a wheel that brushes the ground again has not landed.
  const brushed = crash === null && sink < BRUSH_MS && throttle >= GO_AROUND;
  const touchdown: Touchdown | null = brushed ? null : { sink, tas, pitch, roll: rolled, load: 1 + sink * TOUCHDOWN_G };
  return {
    ...flown, altitude: ground, flightPath: 0, verticalSpeed: 0, airUp: 0, onGround: true, crash, touchdown,
    // The brakes come on by themselves after a landing, as they are set to before one.
    autobrake: crash === null && !brushed, stalled: false, alphaFloor: false, loadFactor: touchdown?.load ?? 1,
  };
}

/** A step on the wheels. */
function roll(state: AircraftState, input: ControlInput, h: number, env: Environment): AircraftState {
  const gear = env.gear ?? 1;
  const ground = env.ground ?? state.altitude;
  const slope = env.slope ?? 0;
  const q = dynamicPressure(ground, state.tas);
  const mach = machOf(state.tas, ground);
  const { throttle, reverse, spool, flaps, spoilers } = machinery(state, input, h, env, false);
  const wing = wingOf(flaps, spoilers, gear, mach, env.ice ?? 0);
  // Rolling over ground too steep for it ends the flight; so does the gear coming up under it.
  const crash: Crash | null = gear < 0.99 ? "gear" : Math.abs(slope) > LANDING_LIMITS.slope && state.tas > 15 ? "terrain" : null;

  // The nose: lifted by the stick once there is air enough over the tail, let down again without it.
  const authority = clamp(q / Q_ROTATION_PA - 0.5, 0, 1.2);
  const pitchDemand = input.pitch > 0 ? input.pitch * ROTATION_RATE * authority : -NOSE_FALLS * (state.pitch > 0 ? 1 : 0);
  const pitchRate = state.pitchRate + (pitchDemand - state.pitchRate) * lag(h, PITCH_LAG_S);
  const pitch = clamp(state.pitch + pitchRate * h, 0, TAIL_STRIKE);
  const alpha = pitch;

  const cl = liftAt(wing, alpha);
  const lift = q * WING_M2 * cl;
  const induced = CD_INDUCED * cl * cl * groundEffect(WING_OVER_WHEELS_M);
  const drag = q * WING_M2 * (CD_ZERO + wing.drag + induced);
  const thrust = thrustAt(ground, state.tas) * Math.max(spool, IDLE) * (1 - (1 + REVERSE_SHARE) * reverse);
  const carried = Math.max(0, WEIGHT_N - lift);

  // The brakes: held, all of them; after a landing, as much as slows it steadily, less what the reversers already do.
  const autobrake = state.autobrake && throttle < 0.15 && !input.brake && state.tas > 1;
  const most = BRAKING * carried;
  const along = thrust - drag - ROLLING * carried - WEIGHT_N * slope;
  const braking = input.brake ? most : autobrake ? clamp(MASS_KG * AUTOBRAKE_MS2 + along, 0, most) : 0;
  let tas = state.tas + ((along - braking) / MASS_KG) * h;
  // Standing still is standing still: what holds it does not push it backwards.
  if (tas < 0.05 && along - braking <= 0) tas = 0;
  tas = Math.max(tas, 0);

  // The nose wheel steers: briskly at a walk, and no harder than the tyres hold at speed.
  const steering = Math.min(STEERING_RATE, tas > 1 ? (STEERING_G * G) / tas / RADIANS : STEERING_RATE) * Math.min(1, tas / 3);
  const heading = wrap360(state.heading + input.yaw * steering * h);
  const rolled = state.roll * (1 - lag(h, 0.3));
  const [lon, lat] = destination(state.lon, state.lat, heading, tas * h * env.warp);

  const rolling: AircraftState = {
    lon, lat, altitude: ground, heading, pitch, roll: rolled, tas, flightPath: 0, throttle, spool, reverse, rollRate: 0, pitchRate,
    flaps, spoilers, airUp: 0, alphaWanted: alpha, onGround: true, autobrake, touchdown: state.touchdown, crash, verticalSpeed: 0,
    alpha, loadFactor: 1, stalled: false, alphaFloor: false,
  };
  // Off again once the wing carries all of it: with thrust on, that is. Landed and at idle the gear has
  // taken the weight and the spoilers are on their way up, and it stays down.
  const staying = state.touchdown !== null && throttle < GO_AROUND;
  if (lift <= WEIGHT_N * LIFT_OFF || crash || staying) return rolling;
  return { ...rolling, onGround: false, touchdown: null, loadFactor: lift / WEIGHT_N, altitude: ground + 0.01 };
}

/** Where the aircraft will be in `seconds`, flying on as it is: straight, at its vertical speed. */
export function ahead(state: AircraftState, seconds: number, warp = 1): { lon: number; lat: number; altitude: number } {
  const travelled = state.tas * Math.cos(state.flightPath * RADIANS) * seconds * warp;
  const [lon, lat] = destination(state.lon, state.lat, state.heading, travelled);
  return { lon, lat, altitude: state.altitude + state.verticalSpeed * seconds };
}

/** How far ahead the ground is looked for, seconds, and how close to it the warning sounds, metres. */
export const TERRAIN_LOOKAHEAD_S = [5, 10, 20];
export const TERRAIN_CLEARANCE_M = 150;

/**
 * Whether the ground is coming up: flying on as it is, the aircraft would be
 * within `TERRAIN_CLEARANCE_M` of it at one of the look-ahead times. Where
 * the ground is not known, nothing is said.
 */
export function terrainAhead(
  state: AircraftState, groundAt: (lon: number, lat: number) => number | null, warp = 1,
): boolean {
  return TERRAIN_LOOKAHEAD_S.some((seconds) => {
    const at = ahead(state, seconds, warp);
    const ground = groundAt(at.lon, at.lat);
    return ground !== null && at.altitude - ground < TERRAIN_CLEARANCE_M;
  });
}

/** The landing gear `dt` seconds on: from `position` (0 up to 1 down) towards down or up, at its own steady pace. */
export function moveGear(position: number, down: boolean, dt: number): number {
  const step = Math.max(dt, 0) / GEAR_S;
  return down ? Math.min(1, position + step) : Math.max(0, position - step);
}

/** Whether the aircraft is past its speed limits: its own, or those of the flaps and the gear as they are. */
export function overspeed(state: AircraftState, indicated: number, gear = 0): boolean {
  return machOf(state.tas, state.altitude) > MMO || indicated > speedsFor(state.flaps, 0, gear).limit;
}

/** The indicated airspeed of a state, m/s. */
export const indicatedOf = (state: AircraftState): number => indicatedFromTrue(state.tas, state.altitude);
