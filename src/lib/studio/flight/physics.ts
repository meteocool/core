/**
 * How the aircraft flies: an airliner-class twin, arcade but plausible.
 *
 * Not a six-degree-of-freedom model. The controls command rates, the way an
 * airliner's fly-by-wire does in its normal law, because that is what a
 * keyboard flies well: a key held rolls or pitches at a steady rate, and let
 * go the aircraft holds the attitude it was left in. Under that the point
 * mass is honest: the wing has to make the lift the turn asks for, which
 * takes angle of attack, which costs drag and bends the flight path down
 * from where the nose points; thrust falls off with the thin air up high;
 * the drag climbs steeply as the speed nears that of sound; slow far enough
 * and the wing stalls.
 *
 * Everything is SI (metres, seconds, m/s) and angles are degrees: heading
 * clockwise from north, pitch nose up and roll right wing down positive.
 * The altitude is true, above sea level, as the instruments show it; the
 * map draws the world taller than life, which is the camera's concern.
 *
 * Deterministic: the turbulence comes in from outside as a gust, so the same
 * inputs always fly the same path, which is what the tests rely on.
 */
import { density, machOf } from "./atmosphere";
import { destination, wrap360 } from "./geo";

export const G = 9.80665;

/** The aircraft: about an A320's mass and wing, clean. */
const MASS_KG = 65_000;
const WING_M2 = 122.6;
const WEIGHT_N = MASS_KG * G;

/** Lift: at zero angle of attack, and per degree of it; the stall, and where a stalled wing recovers. */
const CL_ZERO = 0.25;
const CL_PER_DEG = 0.087;
export const STALL_ALPHA = 15;
const RECOVER_ALPHA = 11;
const CL_MAX = CL_ZERO + CL_PER_DEG * STALL_ALPHA;
/** As far as the angle of attack is taken; past it the flight path only steepens. */
const MAX_ALPHA = 35;

/** Drag: the airframe's own, and the lift's (1 / (pi AR e) for a wing of aspect ratio 9.5). */
const CD_ZERO = 0.022;
const CD_INDUCED = 0.045;
/** The speed brake out, and a stalled wing's buffeting. */
const CD_BRAKE = 0.03;
const CD_STALL = 0.06;
/** The landing gear down: about what an airliner's adds, which is about what its speed brake does. */
export const CD_GEAR = 0.02;
/** How long the gear takes to go all the way up or down, seconds. */
export const GEAR_S = 7;

/**
 * Where the drag starts to climb with Mach number, and where it climbs
 * steeply: a wall just short of the speed of sound that full thrust does
 * not push through.
 */
const MACH_DRAG_RISE = 0.8;
const MACH_WALL = 0.88;
/** Past this, the overspeed warning: an airliner's maximum operating Mach, and its indicated limit (340 kt). */
export const MMO = 0.86;
export const VMO_MS = 175;

/**
 * Both engines' thrust at full throttle at sea level, newtons, falling off
 * with the density to the power below. Calibrated so that 85% holds Mach
 * 0.80 level at FL350 (physics.test.ts).
 */
const THRUST_SEA_LEVEL_N = 127_000;
const THRUST_LAPSE = 0.8;
/** What the engines give at idle, as a share of full. */
const IDLE = 0.03;
/** How long the engines take to follow the throttle, seconds. */
const SPOOL_S = 1.8;
/** How fast W and S move the throttle, a share a second. */
const THROTTLE_PER_S = 0.35;

/** A full roll input, degrees a second; how long the roll rate takes to follow it, seconds. */
export const ROLL_RATE = 20;
const ROLL_LAG_S = 0.3;
/** The bank the controls stop at, and the one the aircraft rolls back to when let go past it. */
export const BANK_LIMIT = 67;
export const BANK_HOLD = 33;
const BANK_RETURN_RATE = 6;
/** A full pitch input at the reference dynamic pressure, degrees a second, and its lag. */
export const PITCH_RATE = 5;
const PITCH_LAG_S = 0.4;
const Q_REFERENCE_PA = 14_000;
/** The pitch the controls stop at, nose up and nose down. */
export const PITCH_UP_LIMIT = 30;
export const PITCH_DOWN_LIMIT = -20;
/** A stalled aircraft drops its nose this fast, degrees a second. */
const STALL_NOSE_DROP = 6;
/** The rudder's yaw, degrees a second, and the roll it brings with it. */
const YAW_RATE = 3;
const YAW_ROLL = 2;

/** The slowest the model is taken to; nothing is drawn of an aircraft slower than this anyway. */
const MIN_TAS = 40;
/** The longest a step may be: a frame stalled for a second is flown as 50 ms, not as a lurch. */
export const MAX_DT = 0.05;

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
  /** Where the throttle is, 0 to 1, and what the engines give of it so far. */
  throttle: number;
  spool: number;
  /** The attitude rates the controls have reached, degrees a second. */
  rollRate: number;
  pitchRate: number;
  /**
   * The pitch held with no pitch input, less what a turn adds to it; null
   * while the pitch is being moved. Held this way, a level turn stays level.
   */
  pitchHold: number | null;
  /** What follows from the rest: m/s, degrees, g, and whether the wing has stalled. */
  verticalSpeed: number;
  flightPath: number;
  alpha: number;
  loadFactor: number;
  stalled: boolean;
}

/** The stick, the rudder and the throttle lever, each -1 to 1. */
export interface ControlInput {
  /** Nose up positive. */
  pitch: number;
  /** Right wing down positive. */
  roll: number;
  /** Nose right positive. */
  yaw: number;
  /** Throttle up positive: how fast the lever moves, not where it is. */
  throttle: number;
  /** The speed brake, while held. */
  brake: boolean;
}

export const NO_INPUT: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };

/** A gust: degrees a second of roll and pitch, and m/s up. */
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
  /** How far the landing gear is down, 0 up to 1 down, which drags; up where not said. */
  gear?: number;
}

export const STILL_AIR: Environment = { warp: 1, gust: CALM, autopilot: null };

const RADIANS = Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
/** How far a first-order lag of time constant `tau` closes in `dt`. */
const lag = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

/** The dynamic pressure, pascals. */
export const dynamicPressure = (altitude: number, tas: number): number => 0.5 * density(altitude) * tas * tas;

/** The load factor a bank asks of the wing in a level turn. */
const loadOf = (roll: number) => 1 / Math.cos(Math.min(Math.abs(roll), 75) * RADIANS);

/** The lift coefficient a load factor needs at a dynamic pressure. */
const liftNeeded = (load: number, q: number) => (load * WEIGHT_N) / (Math.max(q, 1) * WING_M2);

/** The angle of attack that makes a lift coefficient, degrees. */
const alphaFor = (cl: number) => (cl - CL_ZERO) / CL_PER_DEG;

/** The drag coefficient's rise with Mach number. */
function waveDrag(mach: number): number {
  const rise = Math.max(0, mach - MACH_DRAG_RISE);
  const wall = Math.max(0, mach - MACH_WALL);
  return 20 * rise ** 4 + 6 * wall ** 2;
}

/** Full thrust at a height, newtons. */
const thrustAt = (altitude: number) => THRUST_SEA_LEVEL_N * (density(altitude) / 1.225) ** THRUST_LAPSE;

/** The drag in level, unaccelerated flight, newtons. */
function levelDrag(altitude: number, tas: number): number {
  const q = dynamicPressure(altitude, tas);
  const cl = Math.min(liftNeeded(1, q), CL_MAX);
  return q * WING_M2 * (CD_ZERO + CD_INDUCED * cl * cl + waveDrag(machOf(tas, altitude)));
}

/** The throttle that holds a true airspeed level at a height, 0 to 1 (1 where full thrust does not). */
export function trimThrottle(altitude: number, tas: number): number {
  return clamp(levelDrag(altitude, tas) / thrustAt(altitude), 0, 1);
}

/** The angle of attack level flight takes at a height and speed, degrees. */
export function levelAlpha(altitude: number, tas: number): number {
  return alphaFor(liftNeeded(1, dynamicPressure(altitude, tas)));
}

/** An aircraft in level flight, trimmed: what the flight starts with. */
export function levelFlight(lon: number, lat: number, altitude: number, heading: number, tas: number): AircraftState {
  const alpha = levelAlpha(altitude, tas);
  const throttle = trimThrottle(altitude, tas);
  return {
    lon, lat, altitude, heading: wrap360(heading), pitch: alpha, roll: 0, tas, throttle, spool: throttle,
    rollRate: 0, pitchRate: 0, pitchHold: alpha, verticalSpeed: 0, flightPath: 0, alpha, loadFactor: 1, stalled: false,
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

/** Advance the aircraft `dt` seconds (at most `MAX_DT`). */
export function step(state: AircraftState, input: ControlInput, dt: number, env: Environment = STILL_AIR): AircraftState {
  const h = clamp(dt, 0, MAX_DT);
  if (h === 0) return state;
  const q = dynamicPressure(state.altitude, state.tas);
  const autopilot = env.autopilot !== null;

  // What a turn adds to the angle of attack, which a let-go stick makes up
  // for with pitch so the turn stays level; only in a normal turn's bank.
  const turnAlpha = alphaFor(liftNeeded(loadOf(Math.min(Math.abs(state.roll), BANK_HOLD)), q))
    - alphaFor(liftNeeded(1, q));

  let pitchHold = state.pitchHold;
  let pitchDemand: number;
  if (state.stalled) {
    pitchDemand = -STALL_NOSE_DROP;
    pitchHold = null;
  } else if (autopilot) {
    const climb = clamp((env.autopilot! - state.altitude) * 0.08, -12, 12);
    const path = Math.asin(clamp(climb / state.tas, -0.3, 0.3)) / RADIANS;
    pitchDemand = clamp((path + state.alpha - state.pitch) * 0.8, -2.5, 2.5);
    pitchHold = null;
  } else if (input.pitch !== 0) {
    const authority = clamp(q / Q_REFERENCE_PA, 0.25, 1.3);
    // As the bank: ever slower towards the limit, and back from past it.
    const room = input.pitch > 0 ? PITCH_UP_LIMIT - state.pitch : state.pitch - PITCH_DOWN_LIMIT;
    pitchDemand = input.pitch * clamp(room * 1.2, -PITCH_RATE, PITCH_RATE * authority);
    pitchHold = null;
  } else {
    pitchHold ??= state.pitch - turnAlpha;
    pitchDemand = clamp((pitchHold + turnAlpha - state.pitch) * 1.5, -PITCH_RATE, PITCH_RATE);
  }

  const rollRate = state.rollRate + (rollDemand(state, input, autopilot) - state.rollRate) * lag(h, ROLL_LAG_S);
  const pitchRate = state.pitchRate + (pitchDemand - state.pitchRate) * lag(h, PITCH_LAG_S);
  const roll = clamp(state.roll + (rollRate + env.gust.roll) * h, -85, 85);
  const pitch = clamp(state.pitch + (pitchRate + env.gust.pitch) * h, -60, 60);

  // A coordinated turn, and the rudder's yaw on top.
  const yaw = autopilot ? 0 : input.yaw;
  const headingRate = (G * Math.tan(roll * RADIANS)) / state.tas / RADIANS + yaw * YAW_RATE;
  const heading = wrap360(state.heading + headingRate * h);

  // The lift the bank asks for, and the angle of attack that makes it.
  const loadFactor = loadOf(roll);
  const needed = liftNeeded(loadFactor, q);
  const alphaNeeded = alphaFor(needed);
  const stalled = state.stalled ? alphaNeeded > RECOVER_ALPHA : alphaNeeded > STALL_ALPHA;
  const alpha = Math.min(alphaNeeded, MAX_ALPHA);
  const flightPath = clamp(pitch - alpha, -89, 89);

  const throttle = clamp(state.throttle + input.throttle * THROTTLE_PER_S * h, 0, 1);
  const spool = state.spool + (throttle - state.spool) * lag(h, SPOOL_S);
  const lift = Math.min(needed, CL_MAX);
  const drag = q * WING_M2 * (CD_ZERO + CD_INDUCED * lift * lift + waveDrag(machOf(state.tas, state.altitude))
    + (input.brake ? CD_BRAKE : 0) + (stalled ? CD_STALL : 0) + CD_GEAR * (env.gear ?? 0));
  const thrust = thrustAt(state.altitude) * Math.max(spool, IDLE);
  const accel = (thrust - drag) / MASS_KG - G * Math.sin(flightPath * RADIANS);
  const tas = Math.max(state.tas + accel * h, MIN_TAS);

  const verticalSpeed = tas * Math.sin(flightPath * RADIANS) + env.gust.vertical;
  const altitude = state.altitude + verticalSpeed * h;
  const ground = tas * Math.cos(flightPath * RADIANS) * h * env.warp;
  const [lon, lat] = destination(state.lon, state.lat, heading, ground);

  return {
    lon, lat, altitude, heading, pitch, roll, tas, throttle, spool, rollRate, pitchRate, pitchHold,
    verticalSpeed, flightPath, alpha, loadFactor, stalled,
  };
}

/** Where the aircraft will be in `seconds`, flying on as it is: straight, at its vertical speed. */
export function ahead(state: AircraftState, seconds: number, warp = 1): { lon: number; lat: number; altitude: number } {
  const ground = state.tas * Math.cos(state.flightPath * RADIANS) * seconds * warp;
  const [lon, lat] = destination(state.lon, state.lat, state.heading, ground);
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

/** Whether the aircraft is past its speed limits. */
export function overspeed(state: AircraftState, indicated: number): boolean {
  return machOf(state.tas, state.altitude) > MMO || indicated > VMO_MS;
}
