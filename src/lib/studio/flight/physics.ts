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
 * The attitude is not left to moments and inertias. In pitch it is flown as
 * an airliner's fly-by-wire flies it, which is also what a keyboard flies
 * well: the stick asks for a load factor, and let go the aircraft holds its
 * flight path, trimming itself as the speed changes; in a turn of up to 33
 * degrees it pulls for itself. It will not be pulled into a stall (the
 * angle of attack stops short of what it takes the stall to be, and near it
 * the engines go to full thrust on their own), nor, the right way up,
 * pitched past 30 up and 15 down. Close to the ground with the gear down
 * the stick moves the nose directly, to flare with.
 *
 * In roll and yaw nothing holds it back. The stick is a roll rate and the
 * aircraft goes on rolling for as long as it is held: through knife edge,
 * where the wing holds nothing up, and onto its back, where the lift points
 * at the ground and the nose falls. The rudder slips the nose off the
 * flight path as far as its jacks can hold it against the air, and the slip
 * drags, pushes the path round and rolls the aircraft with it.
 *
 * So the nose and the flight path are two directions, and the angles
 * between them (the angle of attack, the sideslip) are measured, whichever
 * way up the aircraft is; the forces turn the path, the nose rides round
 * with it, and the controls move the one against the other.
 *
 * What the airframe has been through comes in from outside, as the gusts
 * do: ice on the wing costs lift, stalls it sooner than the protections
 * believe, drags, weighs, and chokes the engines; a surface that has
 * fluttered off takes its share of the control of its axis with it, leaves
 * the two sides unlike, and drops the fly-by-wire to a law with no
 * protections; a wing or the tail that has come off (damage.ts) leaves what
 * is left to fall as it would. A
 * flight that ends on the ground and not on its wheels is a wreck, which
 * slides to a stop.
 *
 * Everything is SI (metres, seconds, m/s, newtons) and angles are degrees:
 * heading clockwise from north, pitch nose up and roll right wing down
 * positive, roll from -180 to 180. The altitude is true, above sea level,
 * as the instruments show it; the map draws the world taller than life,
 * which is the camera's concern.
 *
 * Deterministic: the turbulence comes in from outside as a gust, so the same
 * inputs always fly the same path, which is what the tests rely on.
 */
import type { LostSurface } from "../store";
import { density, indicatedFromTrue, machOf, SEA_LEVEL_DENSITY } from "./atmosphere";
import { destination, wrap360 } from "./geo";
import { apply, attitudeOf, multiply, rotation, transpose } from "./view";
import type { Mat3, Vec3 } from "./view";

export const G = 9.80665;

const MASS_KG = 65_000;
export const WING_M2 = 122.6;
const SPAN_M = 34.1;
export const WEIGHT_N = MASS_KG * G;

/** Lift, clean: at zero angle of attack, and per degree of it. */
const CL_ZERO = 0.25;
const CL_PER_DEG = 0.087;
/** Past the stall the lift falls away by this much a degree, down to this share of its most. */
const CL_STALL_DROP = 0.06;
const CL_STALLED_LEAST = 0.6;
/** How far short of the stall a stalled wing has to come to fly again, degrees. */
const STALL_RECOVERY = 3;
/** The most lift the wing makes pushed the other way, upside down as it then is; at the speed of sound's doorstep less, as the right way up. */
const CL_NEGATIVE_MOST = 0.6;
/**
 * Past this angle to the air, either way, the wing is a plate held across
 * it: what lift it has left goes round with twice the angle, to nothing
 * broadside on and the other way beyond.
 */
const BROADSIDE = 45;

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
/** The wing held flat across the air, and the hull held sideways across it; the first comes in between these angles of attack. */
const CD_FLAT = 1.2;
const CD_FLAT_FROM = [25, 50];
const CD_SIDE = 0.5;
/** The push sideways of a hull slipping through the air, for all of the slip. */
const CY_SLIP = 0.9;

/**
 * Ice, all of it there can be (1): the wing stalls this much sooner and
 * lifts this much less for its angle, the flaps add this much less, and the
 * most it lifts is down by a third; the airframe drags as much again and
 * the lift costs more; it weighs this much more. The ailerons do half of
 * what they did, and near the stall (from this share of the angle it
 * stalls at) one wing lets go before the other, at up to this many degrees
 * a second. From this much ice the engines take it in, and by all of it
 * have lost this share of their thrust.
 */
const ICE_STALL = 0.3;
const ICE_SLOPE = 0.1;
const ICE_FLAPS = 0.15;
const ICE_DRAG = 1;
const ICE_INDUCED = 0.25;
const ICE_WEIGHT = 0.04;
const ICE_ROLL = 0.5;
const ICE_ROLL_OFF = 22;
const ICE_ROLL_OFF_FROM = 0.75;
const ICE_ENGINES_FROM = 0.6;
const ICE_THRUST = 0.35;
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
export const IDLE_SPOOL = 0.05;
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

/**
 * A full roll input, degrees a second, where the air is fast enough for all
 * of it: slower there is less, down to this share, and on an approach about
 * three fifths. How long the roll rate takes to follow, seconds. Nothing
 * stops the roll and nothing rolls it back.
 */
export const ROLL_RATE = 25;
const ROLL_LEAST = 0.4;
const ROLL_LAG_S = 0.3;
/** The bank up to which a turn is pulled for without the stick. */
export const BANK_HOLD = 33;
/**
 * The rudder. All of it slips the nose this far off the flight path,
 * degrees, up to the dynamic pressure where its jacks can no longer hold it
 * against the air (about 190 kt), and less as that grows. The nose follows
 * in this long, seconds, and no faster than this, degrees a second; a slip
 * rolls the aircraft with it, by this much a second for each degree.
 */
const RUDDER_SLIP = 12;
const Q_BLOWDOWN_PA = 6000;
const YAW_LAG_S = 0.9;
const YAW_RATE_MOST = 25;
const SLIP_ROLL = 0.6;
/**
 * What is left when parts have come off (damage.ts). One wing lifting
 * alone rolls the aircraft towards the stump at this many degrees a second
 * for each g it lifts, and its drag slews the nose this far, degrees; its
 * aileron does this share of what one of two did. A hull without wings
 * still lifts this share of what they did. Without its tail nothing holds
 * the nose: it tucks under at this rate, degrees a second, and swings round
 * at this one.
 */
const TORN_ROLL = 240;
const TORN_SLIP = 8;
const TORN_STICK = 0.25;
const HULL_LIFT = 0.06;
const TAILLESS_TUCK = 28;
const TAILLESS_SWING = 18;
/** The fastest a stalled wing swings the nose back towards the air, degrees a second. */
const TUMBLE_MOST = 60;
/**
 * What is left when surfaces have fluttered off (damage.ts), the wings and
 * the tail still on. The roll: each aileron is half of what the stick gets;
 * with neither, the spoiler of the wing going down still rolls it at this
 * share, and with that gone too hardly anything does. An aileron gone
 * leaves a gap and a stub on its wing, which lifts less and drags more:
 * the aircraft rolls towards it, at this many degrees a second (as much as
 * the air's pressure gives it, `felt`), and slips this far towards it. The
 * pitch: each elevator is half of it; one alone twists the tailplane, which
 * rolls the aircraft a little away from the side that has gone and lets the
 * nose down. With neither, only the stabiliser's trim moves the nose: the
 * stick turns it to an angle of attack, this many degrees a second, which
 * the nose comes round to at this rate, following the path; at a held angle
 * of attack the speed and the height trade back and forth, which nothing
 * damps. Without the rudder the pedals do nothing and nothing damps the yaw:
 * a gust sets the nose swinging and the wings rocking with it, a Dutch roll
 * of this period, seconds, that dies away slowly. A spoiler gone with the
 * speed brake out leaves its wing lifting more, a flap gone with the flaps
 * out leaves it lifting less, which rolls it the one way or the other;
 * each is this share of all the spoilers' or the flaps' lift; a slat gone
 * stalls the wing this many degrees sooner. Each surface takes this much
 * drag with it; and with any gone the fly-by-wire falls back to its
 * alternate law, which protects nothing: the stick asks this many times as
 * many g, up to these, and pulls the wing this far past its stall if it is
 * held there.
 */
const SHED_ROLL_SPOILER = 0.3;
const SHED_ROLL_BARE = 0.06;
const SHED_AILERON_ROLL = 3;
const SHED_AILERON_SLIP = 1.5;
const SHED_ELEVATOR_ROLL = 1.2;
const SHED_ELEVATOR_PITCH = 0.6;
const TRIM_RATE = 0.5;
const TRIM_GAIN = 0.8;
const DUTCH_ROLL = { period: 5, damping: 0.06, gust: 0.4 };
const SHED_SPOILER_ROLL = 8;
const SHED_FLAP_ROLL = 8;
const SHED_SPOILER_SHARE = 0.4;
const SHED_FLAP_SHARE = 0.3;
const SHED_SLAT_STALL = 1.5;
const SHED_DRAG = 0.0015;
const ALTERNATE_STICK = 2;
const ALTERNATE_LOADS = [-2, 4] as const;
const ALTERNATE_PAST_STALL = 4;

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
/** The pitch the controls stop at, nose up and nose down; banked steeper than this, degrees, they begin to let go of it. */
export const PITCH_UP_LIMIT = 30;
export const PITCH_DOWN_LIMIT = -15;
const PITCH_LIMITS_TO = 45;
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

/**
 * A wreck. Coming down at this many m/s or more it stops where it hits;
 * more gently, it keeps that much more of its speed over the ground, and
 * slides: held back by this share of its weight, and by as much again for
 * every so many m/s it still has, ploughing. It swings round towards the
 * wing it came down on, by this many degrees a second for each degree that
 * wing was low, and no faster than this; and settles flat, or on the stump
 * of a wing that is gone, in this long, seconds.
 */
const WRECK_STOPS_MS = 30;
const WRECK_FRICTION = 0.7;
const WRECK_PLOUGH_MS = 80;
const WRECK_SWING = 1.5;
const WRECK_SWING_MOST = 40;
const WRECK_SETTLES_S = 0.3;
const WRECK_LEAN = 7;

/** What the gear feels of a touchdown, g for each m/s it came down at. */
const TOUCHDOWN_G = 0.4;

/** The slowest the aircraft is taken to fly at, m/s: slower, it only falls. */
const MIN_FLYING_MS = 25;
/** The longest a step may be: a frame stalled for a second is flown as 50 ms, not as a lurch. */
export const MAX_DT = 0.05;

/** Why a flight ended on the ground and not on its wheels: the last, that it came down in pieces. */
export type Crash = "terrain" | "gear" | "hard" | "attitude" | "fast" | "breakup";

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
  /** Where the flight path points: degrees above the horizon, and over the ground, clockwise from north. */
  flightPath: number;
  track: number;
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
  /** How far the nose is slipped off the flight path, degrees, to the right of it positive; and how fast that is changing, degrees a second. */
  slip: number;
  slipRate?: number;
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
  /**
   * How the ground under the aircraft lies, degrees: nose up where it rises
   * ahead, and right wing down where it falls away to the right. What the
   * wheels stand it at; level where not said.
   */
  tilt?: { pitch: number; roll: number };
  /** Ice on the airframe, 0 to 1: the wing lifts less and stalls sooner, it drags and weighs, and the engines choke on it. */
  ice?: number;
  /** What has come off the aircraft; nothing where not said. */
  lost?: Lost;
  /** The flaps jammed where they are, whatever the lever says. */
  flapsStuck?: boolean;
}

/**
 * The parts an aircraft can lose and still be an aircraft of a kind: each
 * wing, with its engine, and the tail; and, short of that, the surfaces
 * that have fluttered off, in the order they went.
 */
export interface Lost {
  leftWing?: boolean;
  rightWing?: boolean;
  tail?: boolean;
  surfaces?: readonly LostSurface[];
}

export const STILL_AIR: Environment = { gust: CALM, autopilot: null };

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
  /** The lift at zero angle of attack, and what each degree adds. */
  liftZero: number;
  slope: number;
  /** The angle it stalls at; the angle it stalls at pushed the other way, and the lift it has there. */
  stallAlpha: number;
  lowAlpha: number;
  least: number;
  /** The share of its lift the spoilers leave it, and the share of the wing that is still there. */
  kept: number;
  /** The drag of what hangs out of it and off it, and what its lift costs. */
  drag: number;
  induced: number;
}

/** What surfaces gone from a wing that is still on cost it: the share of the flaps' lift left, degrees of stall, and drag. */
interface Torn {
  flaps: number;
  slats: number;
  drag: number;
}

const UNTORN: Torn = { flaps: 1, slats: 0, drag: 0 };

function wingOf(flaps: number, spoilers: number, gear: number, mach: number, ice: number, share = 1, torn: Torn = UNTORN): Wing {
  const shut = clamp((mach - MACH_STALL_FROM) / MACH_STALL_SPAN, 0, 1) * MACH_STALL_LOSS;
  // Ice roughens the wing: less lift for its angle, less from the flaps, and a stall that comes sooner.
  const liftZero = CL_ZERO + between(FLAP_LIFT, flaps) * (1 - ICE_FLAPS * ice) * torn.flaps;
  const slope = CL_PER_DEG * (1 - ICE_SLOPE * ice);
  const least = -CL_NEGATIVE_MOST * (1 - shut) * (1 - ICE_STALL * ice);
  return {
    liftZero,
    slope,
    stallAlpha: between(FLAP_STALL_ALPHA, flaps) * (1 - shut) * (1 - ICE_STALL * ice) - torn.slats,
    lowAlpha: (least - liftZero) / slope,
    least,
    kept: (1 - SPOILER_LIFT_LOSS * spoilers * spoilers) * share,
    drag: between(FLAP_DRAG, flaps) + CD_GEAR * gear + SPOILER_DRAG[0] * spoilers + SPOILER_DRAG[1] * spoilers * spoilers
      + CD_ZERO * ICE_DRAG * ice + torn.drag,
    induced: CD_INDUCED * (1 + ICE_INDUCED * ice),
  };
}

/**
 * The lift coefficient at an angle of attack, whatever the angle: up its
 * slope to the stall, falling away past it, and from `BROADSIDE` on what a
 * plate across the air has; the same the other way up.
 */
function liftAt(wing: Wing, alpha: number): number {
  const most = wing.liftZero + wing.slope * wing.stallAlpha;
  let lift: number;
  if (alpha > BROADSIDE) lift = most * CL_STALLED_LEAST * Math.sin(2 * alpha * RADIANS);
  else if (alpha > wing.stallAlpha) lift = Math.max(most - CL_STALL_DROP * (alpha - wing.stallAlpha), most * CL_STALLED_LEAST);
  else if (alpha >= wing.lowAlpha) lift = wing.liftZero + wing.slope * alpha;
  else if (alpha >= -BROADSIDE) lift = Math.min(wing.least + CL_STALL_DROP * (wing.lowAlpha - alpha), wing.least * CL_STALLED_LEAST);
  else lift = -wing.least * CL_STALLED_LEAST * Math.sin(2 * alpha * RADIANS);
  return lift * wing.kept;
}

/** The angle of attack that makes a lift coefficient, on the slope, degrees. */
const alphaFor = (wing: Wing, cl: number) => (cl / wing.kept - wing.liftZero) / wing.slope;

/** The drag of a wing past its stall either way, and of one held flat across the air. */
function stalledDrag(wing: Wing, alpha: number): number {
  const past = Math.max(alpha - wing.stallAlpha, wing.lowAlpha - alpha);
  const flat = CD_FLAT * Math.sin(alpha * RADIANS) ** 2 * clamp((Math.abs(alpha) - CD_FLAT_FROM[0]) / (CD_FLAT_FROM[1] - CD_FLAT_FROM[0]), 0, 1);
  return Math.max(clamp(past * CD_STALL_PER_DEG, 0, CD_STALL_MOST), flat);
}

/** The dynamic pressure, pascals. */
export const dynamicPressure = (altitude: number, tas: number): number => 0.5 * density(altitude) * tas * tas;

/** The lift coefficient a load factor needs at a dynamic pressure. */
const liftNeeded = (load: number, q: number, weight = WEIGHT_N) => (load * weight) / (Math.max(q, 1) * WING_M2);

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
    thrust = clamp(q * WING_M2 * (CD_ZERO + wing.drag + CD_INDUCED * cl * cl + waveDrag(mach)) + along, IDLE_SPOOL * full, full);
    alpha = alphaFor(wing, liftNeeded(Math.cos(path * RADIANS) - (thrust * Math.sin(alpha * RADIANS)) / WEIGHT_N, q));
  }
  return { alpha, throttle: thrust <= IDLE_SPOOL * full ? 0 : thrust / full };
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
  stalled: false, alphaFloor: false, slip: 0,
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
    ...DERIVED, lon, lat, altitude, heading: wrap360(heading), pitch: path + alpha, roll: 0, tas, flightPath: path,
    track: wrap360(heading), throttle,
    spool: Math.max(throttle, IDLE_SPOOL), flaps: trim.flaps ?? 0, onGround: false, verticalSpeed: tas * Math.sin(path * RADIANS), alpha,
    alphaWanted: alpha, loadFactor: Math.cos(path * RADIANS),
  };
}

/** An aircraft standing on its wheels, engines at idle, flaps set for take-off: `ground` is how high it stands. */
export function parked(lon: number, lat: number, ground: number, heading: number): AircraftState {
  return {
    ...DERIVED, lon, lat, altitude: ground, heading: wrap360(heading), pitch: 0, roll: 0, tas: 0, flightPath: 0,
    track: wrap360(heading), throttle: 0, spool: IDLE_SPOOL,
    flaps: 1, onGround: true, verticalSpeed: 0, alpha: 0, alphaWanted: 0, loadFactor: 1,
  };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** An attitude turned on by `rate` (radians a second about its direction, in the world) for `h` seconds. */
export function turned(attitude: Mat3, rate: Vec3, h: number): Mat3 {
  const angle = Math.hypot(...rate) * h;
  if (angle < 1e-12) return attitude;
  const [x, y, z] = rate.map((value) => (value * h) / angle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return multiply([
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ], attitude);
}

/** What is left of the aircraft to fly with. */
function airframeOf(lost: Lost | undefined) {
  const wings = (lost?.leftWing ? 0 : 1) + (lost?.rightWing ? 0 : 1);
  const gone = new Set(lost?.surfaces ?? []);
  /** How many of a pair are still on; and which side is not, -1 the left, 0 both or neither. */
  const pair = (left: LostSurface, right: LostSurface) => (gone.has(left) ? 0 : 1) + (gone.has(right) ? 0 : 1);
  const side = (left: LostSurface, right: LostSurface) => (gone.has(left) ? -1 : 0) + (gone.has(right) ? 1 : 0);
  const ailerons = pair("leftAileron", "rightAileron");
  // Rolling right, the right wing's spoiler stands up; rolling left, the left one's.
  const rolls = (spoiler: LostSurface) => (ailerons ? ailerons / 2 : gone.has(spoiler) ? SHED_ROLL_BARE : SHED_ROLL_SPOILER);
  return {
    /** What the surfaces still on give the stick: of the roll each way, of the pitch; and whether the pedals move anything. */
    roll: { left: rolls("leftSpoiler"), right: rolls("rightSpoiler") },
    pitch: pair("leftElevator", "rightElevator") / 2,
    rudder: !gone.has("rudder"),
    /** Which side has lost its aileron, its elevator, its spoiler, its flap: -1 the left. */
    gap: {
      aileron: side("leftAileron", "rightAileron"), elevator: side("leftElevator", "rightElevator"),
      spoiler: side("leftSpoiler", "rightSpoiler"), flap: side("leftFlap", "rightFlap"),
    },
    /** The share of the spoilers' say left, and what the wing has lost. */
    spoilers: 1 - SHED_SPOILER_SHARE * (2 - pair("leftSpoiler", "rightSpoiler")),
    torn: {
      flaps: 1 - SHED_FLAP_SHARE * (2 - pair("leftFlap", "rightFlap")),
      slats: SHED_SLAT_STALL * (2 - pair("leftSlat", "rightSlat")),
      drag: SHED_DRAG * gone.size,
    },
    /** Whether the fly-by-wire still has every surface it flies with, and so its protections. */
    normal: gone.size === 0,
    /** The share of the wing's lift there still is; and of the engines' thrust, and the ailerons' say: each wing takes its own with it. */
    lift: wings === 0 ? HULL_LIFT : wings / 2,
    engines: wings / 2,
    ailerons: wings === 2 ? 1 : (wings / 2) * TORN_STICK,
    /** Which way one wing alone rolls it: -1 to the left, with the left wing gone. */
    lean: (lost?.leftWing ? -1 : 0) + (lost?.rightWing ? 1 : 0),
    tail: !lost?.tail,
    whole: wings === 2 && !lost?.tail,
  };
}

/** The share of their thrust the engines keep with ice going into them. */
const breathing = (ice: number) => 1 - ICE_THRUST * clamp((ice - ICE_ENGINES_FROM) / (1 - ICE_ENGINES_FROM), 0, 1);

/** What the engines and the surfaces that move at their own pace are, a step on. */
function machinery(state: AircraftState, input: ControlInput, h: number, env: Environment, floor: boolean) {
  let throttle = clamp(state.throttle + input.throttle * THROTTLE_PER_S * h, 0, 1);
  // Held at full thrust for the angle of attack, until the lever is moved again.
  if (floor) throttle = 1;
  // The reversers: on the ground, the lever pulled back at idle, and not below the speed they are any use at.
  const reversing = state.onGround && throttle <= 0 && input.throttle < 0 && state.tas > REVERSE_LEAST_MS;
  const reverse = towards(state.reverse, reversing ? 1 : 0, h / REVERSE_S);
  const wanted = Math.max(reverse > 0 ? REVERSE_POWER * reverse : 0, throttle, IDLE_SPOOL);
  // An engine at idle takes its time to wake up; one already running hard follows at once.
  const spool = state.spool + (wanted - state.spool) * lag(h, SPOOL_S + SPOOL_SLOW_S * (1 - state.spool) ** 2);
  const flaps = env.flapsStuck
    ? state.flaps
    : towards(state.flaps, clamp(Math.round(env.flapLever ?? state.flaps), 0, FLAPS_MOST), h / FLAP_NOTCH_S);
  // After a landing, at idle, every spoiler stands up; in the air the speed brake's do, though not with the flaps all the way out.
  const brake = (env.speedbrake || input.brake) && flaps < FLAPS_MOST - 0.5 && !floor;
  const dumping = state.touchdown !== null && throttle < 0.15 && state.tas > 5;
  const spoilers = towards(state.spoilers, state.onGround ? (dumping ? 1 : 0) : brake ? SPEEDBRAKE : 0, h / SPOILER_S);
  return { throttle, reverse, spool, flaps, spoilers };
}

/** Why a touchdown is not a landing, or null where it is one. */
function crashOf(state: AircraftState, sink: number, env: Environment): Crash | null {
  if (!airframeOf(env.lost).whole) return "breakup";
  // Flown into the ground, it matters little where the wheels were.
  if (sink > LANDING_LIMITS.sink * 3) return "hard";
  if ((env.gear ?? 0) < 0.99) return "gear";
  if (Math.abs(env.slope ?? 0) > LANDING_LIMITS.slope) return "terrain";
  if (sink > LANDING_LIMITS.sink) return "hard";
  if (Math.abs(state.roll) > LANDING_LIMITS.roll || state.pitch < LANDING_LIMITS.pitch[0] || state.pitch > LANDING_LIMITS.pitch[1]) {
    return "attitude";
  }
  if (state.tas > LANDING_LIMITS.speed) return "fast";
  return null;
}

/** Advance the aircraft `dt` seconds (at most `MAX_DT`). One that has crashed is a wreck, which only slides to a stop. */
export function step(state: AircraftState, input: ControlInput, dt: number, env: Environment = STILL_AIR): AircraftState {
  const h = clamp(dt, 0, MAX_DT);
  if (h === 0) return state;
  if (state.crash) return wreck(state, h, env);
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
  const ice = clamp(env.ice ?? 0, 0, 1);
  const left = airframeOf(env.lost);
  const weight = WEIGHT_N * (1 + ICE_WEIGHT * ice);
  const mass = weight / G;

  // Near the stall the engines go to full thrust on their own, and stay there until the lever is moved. The stall the
  // protections know is a clean wing's: one with ice on it lets go sooner than they think.
  // Not in the alternate law, which protects nothing.
  const floor = left.whole && left.normal && over > ALPHA_FLOOR_ABOVE_M && !state.stalled
    && ((mach < ALPHA_FLOOR_MACH && state.alpha > wingOf(state.flaps, state.spoilers, gear, mach, 0).stallAlpha - ALPHA_FLOOR)
      || (state.alphaFloor && input.throttle === 0));
  const { throttle, reverse, spool, flaps, spoilers } = machinery(state, input, h, env, floor);
  const wing = wingOf(flaps, spoilers * left.spoilers, gear, mach, ice, left.lift, left.torn);
  const believed = wingOf(flaps, spoilers * left.spoilers, gear, mach, 0, left.lift, left.torn);

  // The air's own rise takes the aircraft along after a moment; until it has, it is a change in the angle of attack.
  const airUp = state.airUp + (env.gust.vertical - state.airUp) * lag(h, 1.5);
  const rise = env.gust.vertical - airUp;

  // Where the aircraft points and where it is going, as directions in the world (north, east, down); and the second as
  // the first sees it, which is the angle of attack and the slip: held against the flight path, and met in the air.
  const attitude = rotation(state);
  const inward = transpose(attitude);
  const [nose, right, below] = inward;
  const path = state.flightPath * RADIANS;
  const course = state.track * RADIANS;
  const going: Vec3 = [Math.cos(path) * Math.cos(course), Math.cos(path) * Math.sin(course), -Math.sin(path)];
  const held = apply(inward, going);
  const alphaHeld = Math.atan2(held[2], held[0]) / RADIANS;
  const slip = -Math.asin(clamp(held[1], -1, 1)) / RADIANS;
  const met = apply(inward, [going[0] * speed, going[1] * speed, going[2] * speed + rise]);
  const alpha = Math.atan2(met[2], met[0]) / RADIANS;
  const slipMet = -Math.asin(clamp(met[1] / Math.hypot(...met), -1, 1));
  const past = (margin: number) => alpha > wing.stallAlpha - margin || alpha < wing.lowAlpha + margin;
  const stalled = past(state.stalled ? STALL_RECOVERY : 0);

  // The forces: the lift square to the flight path in the aircraft's own upright plane, the slip's push square to both,
  // the drag back along the path, the thrust along the nose, and the weight.
  const cl = liftAt(wing, alpha);
  const induced = wing.induced * cl * cl * groundEffect(over + WING_OVER_WHEELS_M);
  const drag = q * WING_M2 * (CD_ZERO + wing.drag + induced + waveDrag(mach) + stalledDrag(wing, alpha) + CD_SIDE * Math.sin(slipMet) ** 2);
  const thrust = thrustAt(state.altitude, speed) * Math.max(spool, IDLE_SPOOL) * left.engines * breathing(ice);
  const lift = q * WING_M2 * cl;
  const push = q * WING_M2 * CY_SLIP * Math.sin(slipMet);
  const loadFactor = (lift + thrust * Math.sin(alpha * RADIANS)) / weight;
  const square = cross(right, going);
  const squared = Math.hypot(...square);
  const up: Vec3 = squared > 1e-6 ? [square[0] / squared, square[1] / squared, square[2] / squared] : [-below[0], -below[1], -below[2]];
  const aside = cross(going, up);
  const pull = [0, 1, 2].map((i) => (thrust * nose[i] + lift * up[i] + push * aside[i] - drag * going[i]) / mass) as Vec3;
  pull[2] += G;
  // Along the path they change the speed; across it they bend it, which is a turn of so many radians a second.
  const accel = dot(pull, going);
  const bend: Vec3 = [pull[0] - accel * going[0], pull[1] - accel * going[1], pull[2] - accel * going[2]];
  const turn = cross(going, bend).map((value) => value / speed) as Vec3;
  /** How fast the path's bending turns the nose up, about the wings' own line, degrees a second. */
  const pathRate = dot(turn, right) / RADIANS;

  // The load factor asked for: level, a turn's own up to a normal bank, and what the stick adds.
  const limits = flaps > 0.5 ? LOAD_LIMITS.flaps : LOAD_LIMITS.clean;
  const turning = Math.cos(path) / Math.cos(Math.min(Math.abs(state.roll), BANK_HOLD) * RADIANS);
  let pitchDemand: number;
  let alphaWanted = alpha;
  if (!left.tail) {
    // No tail: nothing holds the nose up against the wing, and nothing the stick moves is there.
    pitchDemand = -TAILLESS_TUCK * clamp(q / Q_REFERENCE_PA, 0.3, 1.5);
  } else if (!left.pitch) {
    // No elevators: the stick turns the stabiliser's trim, which sets an angle of attack the nose comes round to, slowly.
    alphaWanted = state.alphaWanted + (autopilot ? 0 : input.pitch) * TRIM_RATE * h;
    pitchDemand = (alphaWanted - alphaHeld) * TRIM_GAIN + pathRate;
  } else if (!autopilot && gear > 0.5 && over < FLARE_M) {
    // The flare: the stick is the nose's own rate, and the nose sinks a little if it is not held.
    const authority = clamp(q / Q_REFERENCE_PA, 0.3, 1.2);
    pitchDemand = input.pitch * FLARE_PITCH_RATE * authority - (input.pitch === 0 ? FLARE_NOSE_DOWN : 0)
      // And still not into a stall.
      - Math.max(0, alpha - (believed.stallAlpha - ALPHA_MOST)) * PITCH_GAIN;
  } else {
    let asked: number;
    if (autopilot) {
      const climb = clamp((env.autopilot! - state.altitude) * 0.08, -AUTOPILOT_CLIMB_MS, AUTOPILOT_CLIMB_MS);
      const wantedPath = Math.asin(clamp(climb / speed, -0.3, 0.3));
      asked = Math.cos(path) + clamp((speed * (wantedPath - path)) / (G * AUTOPILOT_PATH_S), -0.3, 0.3);
    } else {
      const stick = (input.pitch > 0 ? input.pitch * STICK_UP_G : input.pitch * STICK_DOWN_G) * (left.normal ? 1 : ALTERNATE_STICK);
      asked = turning + stick / (1 + C_STAR_MS / speed);
      // The nose stops at its limits: the pull, or the push, runs out as it nears them. Rolled well over, a pull no
      // longer lifts the nose, and by knife edge the limits have let go altogether. The alternate law has none.
      const loose = clamp((Math.abs(state.roll) - PITCH_LIMITS_TO) / (90 - PITCH_LIMITS_TO), 0, 1) * (LOAD_LIMITS.clean[1] - LOAD_LIMITS.clean[0]);
      if (left.normal) {
        asked = Math.min(asked, turning + (PITCH_UP_LIMIT - state.pitch) * 0.12 + loose);
        asked = Math.max(asked, turning - (state.pitch - PITCH_DOWN_LIMIT) * 0.12 - loose);
      }
    }
    asked = left.normal ? clamp(asked, limits[0], limits[1]) : clamp(asked, ALTERNATE_LOADS[0], ALTERNATE_LOADS[1]);
    // Not into a stall: with the stick let go the wing stays well short of it, fully back just short. In the alternate
    // law the stick holds it wherever it is pulled, stalled or not.
    const most = left.normal
      ? believed.stallAlpha - ALPHA_PROTECTED + Math.max(0, autopilot ? 0 : input.pitch) * (ALPHA_PROTECTED - ALPHA_MOST)
      : believed.stallAlpha + ALTERNATE_PAST_STALL;
    const least = left.normal ? believed.lowAlpha + ALPHA_MOST : believed.lowAlpha - ALTERNATE_PAST_STALL;
    // What the thrust carries of the weight, tilted up as it is, the wing need not.
    const needed = alphaFor(wing, liftNeeded(asked - (thrust * Math.sin(alpha * RADIANS)) / weight, q, weight));
    alphaWanted = Math.max(Math.min(needed, most), Math.min(least, most));
    // An elevator gone, the other has only its own half of the say.
    const authority = clamp(q / Q_REFERENCE_PA, 0.3, 1.3) * left.pitch;
    // Towards it, along with the flight path as it bends, and ahead of it as it moves: slowing down, it only ever grows.
    const lead = clamp((alphaWanted - state.alphaWanted) / h, -ALPHA_LEAD, ALPHA_LEAD);
    pitchDemand = clamp((alphaWanted - alphaHeld) * PITCH_GAIN + pathRate + lead, -PITCH_RATE * authority, PITCH_RATE * authority);
  }
  // A stalled wing drops the nose, whatever is asked of it; one stalled from above lifts it.
  if (stalled && left.tail) {
    pitchDemand = alpha > 0
      ? Math.min(pitchDemand, Math.max(-(alpha - (wing.stallAlpha - ALPHA_PROTECTED)) * STALL_NOSE_DROP, -TUMBLE_MOST))
      : Math.max(pitchDemand, Math.min((wing.lowAlpha + ALPHA_PROTECTED - alpha) * STALL_NOSE_DROP, TUMBLE_MOST));
  }

  // The roll: the stick's, for as long as it is held and as far round as it goes; a slip's; an iced wing letting go
  // first on the side that is already low; and one wing lifting with no other to answer it.
  const felt = clamp(q / Q_REFERENCE_PA, 0.3, 1.2);
  const rolls = input.roll < 0 ? left.roll.left : left.roll.right;
  let rollDemand = autopilot
    ? clamp(-state.roll * 0.6, -8, 8) * rolls
    : input.roll * ROLL_RATE * clamp(q / Q_REFERENCE_PA, ROLL_LEAST, 1) * (1 - ICE_ROLL * ice) * left.ailerons * rolls;
  rollDemand += SLIP_ROLL * slip * felt;
  rollDemand += ICE_ROLL_OFF * ice * clamp((alpha / wing.stallAlpha - ICE_ROLL_OFF_FROM) / (1.05 - ICE_ROLL_OFF_FROM), 0, 1) * (state.roll < 0 ? -1 : 1);
  rollDemand += left.lean * TORN_ROLL * clamp(lift / weight, -1.5, 1.5);
  // What has fluttered off leaves the two sides unlike: a stub and a gap on one wing rolls it down, a tailplane with one
  // elevator twists it the other way, a speed brake standing up on one side only lifts the other, flaps out on one side lift it.
  const { gap } = left;
  rollDemand += (gap.aileron * SHED_AILERON_ROLL - gap.elevator * SHED_ELEVATOR_ROLL - gap.spoiler * SHED_SPOILER_ROLL * spoilers
    + gap.flap * SHED_FLAP_ROLL * between(FLAP_LIFT, flaps)) * felt;
  // And one elevator alone lets the nose down a little, which the fly-by-wire only half takes back.
  if (gap.elevator && left.tail) pitchDemand -= SHED_ELEVATOR_PITCH * felt;
  const rollRate = state.rollRate + (rollDemand - state.rollRate) * lag(h, ROLL_LAG_S);
  const pitchRate = state.pitchRate + (pitchDemand - state.pitchRate) * lag(h, PITCH_LAG_S);

  // The rudder slips the nose off the path, as far as it can hold it there; let go, the fin brings it back. A stump's
  // drag holds it off to one side, as an aileron's stub does a little; with no fin it swings on round. With no rudder
  // the fin still brings it back, but past the path and on, the yaw damper gone with it: a gust sets it swinging.
  const pedals = autopilot || !left.rudder ? 0 : input.yaw;
  const wantedSlip = pedals * RUDDER_SLIP * Math.min(1, Q_BLOWDOWN_PA / q) - left.lean * TORN_SLIP + gap.aileron * SHED_AILERON_SLIP;
  let slipRate: number;
  if (!left.tail) {
    slipRate = TAILLESS_SWING * (slip < 0 ? -1 : 1);
  } else if (left.rudder) {
    slipRate = clamp(((wantedSlip - slip) / YAW_LAG_S) * clamp(q / Q_REFERENCE_PA, 0.35, 1), -YAW_RATE_MOST, YAW_RATE_MOST);
  } else {
    const swing = ((2 * Math.PI) / DUTCH_ROLL.period) * Math.sqrt(clamp(q / Q_REFERENCE_PA, 0.35, 2));
    const was = state.slipRate ?? 0;
    const swung = -swing * swing * (slip - wantedSlip) - 2 * DUTCH_ROLL.damping * swing * was + env.gust.roll * DUTCH_ROLL.gust;
    slipRate = clamp(was + swung * h, -YAW_RATE_MOST, YAW_RATE_MOST);
  }

  // The nose rides round with the path as it bends, but for the turn about the wings' own line, which is the pitch
  // rate the controls have reached; the roll is about the path, and the slip about the lift. A turn that is also a
  // climb or a descent would wind the bank up or off: that much roll is taken out again, as the stick let go holds a bank.
  const level = Math.hypot(going[0], going[1]);
  const swing = level > 1e-6 ? (bend[1] * going[0] - bend[0] * going[1]) / (level * speed) : 0;
  const winding = swing * clamp(going[2] / Math.max(level, 1e-6), -2, 2);
  const pitching = (pitchRate + env.gust.pitch) * RADIANS - dot(turn, right);
  const rolling = (rollRate + env.gust.roll) * RADIANS + winding;
  const yawing = slipRate * RADIANS;
  const spin = [0, 1, 2].map((i) => turn[i] + pitching * right[i] + rolling * going[i] - yawing * up[i]) as Vec3;
  const { heading, pitch, roll: rolled } = attitudeOf(turned(attitude, spin, h));

  const onward: Vec3 = [going[0] + (bend[0] * h) / speed, going[1] + (bend[1] * h) / speed, going[2] + (bend[2] * h) / speed];
  const flightPath = Math.asin(clamp(-onward[2] / Math.hypot(...onward), -1, 1)) / RADIANS;
  // Going straight up or down, it is going no way over the ground: the track stays what it was.
  const track = Math.hypot(onward[0], onward[1]) > 1e-9 ? wrap360(Math.atan2(onward[1], onward[0]) / RADIANS) : state.track;
  const tas = Math.max(state.tas + accel * h, MIN_FLYING_MS);

  const verticalSpeed = tas * Math.sin(flightPath * RADIANS) + airUp;
  const altitude = state.altitude + verticalSpeed * h;
  const travelled = tas * Math.cos(flightPath * RADIANS) * h;
  const [lon, lat] = destination(state.lon, state.lat, track, travelled);

  const flown: AircraftState = {
    lon, lat, altitude, heading, pitch, roll: rolled, tas, flightPath, track, throttle, spool, reverse, rollRate, pitchRate, flaps,
    spoilers, airUp, alphaWanted, onGround: false, autobrake: false, touchdown: null, crash: null, verticalSpeed, alpha, loadFactor,
    stalled, alphaFloor: floor, slip, slipRate,
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
    // What is left of a wreck's speed is what it had over the ground, less what the ground took of it.
    tas: crash ? tas * Math.cos(flightPath * RADIANS) * clamp(1 - sink / WRECK_STOPS_MS, 0, 1) : tas,
    // The brakes come on by themselves after a landing, as they are set to before one.
    autobrake: crash === null && !brushed, stalled: false, alphaFloor: false, loadFactor: touchdown?.load ?? 1,
  };
}

/** A step of a wreck: sliding on the way it was going, swinging round, settling, the engines dying. Nothing moves it but the ground. */
function wreck(state: AircraftState, h: number, env: Environment): AircraftState {
  const ground = env.ground ?? state.altitude;
  const tas = Math.max(0, state.tas - G * (WRECK_FRICTION + state.tas / WRECK_PLOUGH_MS) * h);
  const came = state.touchdown;
  const swing = came && came.tas > 0 ? clamp(came.roll * WRECK_SWING, -WRECK_SWING_MOST, WRECK_SWING_MOST) * Math.min(1, tas / came.tas) : 0;
  const settle = lag(h, WRECK_SETTLES_S);
  // On its back it stays there; the right way up, it leans on the stump of a wing that is gone.
  const tilt = env.tilt ?? { pitch: 0, roll: 0 };
  const rest = Math.abs(state.roll) > 90 ? Math.sign(state.roll) * 180 : airframeOf(env.lost).lean * WRECK_LEAN + tilt.roll;
  // Close enough to where it comes to rest is there: a wreck that has stopped is the same from then on.
  const closing = (value: number, target: number) => (Math.abs(target - value) < 1e-3 ? target : value + (target - value) * settle);
  const spool = state.spool < 1e-3 ? 0 : state.spool * (1 - lag(h, 1.5));
  const [altitude, pitch, rolled] = [closing(state.altitude, ground), closing(state.pitch, tilt.pitch), closing(state.roll, rest)];
  if (state.tas === 0 && spool === state.spool && altitude === state.altitude && pitch === state.pitch && rolled === state.roll) return state;
  const [lon, lat] = tas > 0 ? destination(state.lon, state.lat, state.track, tas * h) : [state.lon, state.lat];
  return {
    ...state, lon, lat, tas, altitude, heading: wrap360(state.heading + swing * h), pitch, roll: rolled, throttle: 0, reverse: 0,
    spool, rollRate: 0, pitchRate: 0, flightPath: 0, verticalSpeed: 0, airUp: 0, alpha: 0, slip: 0, slipRate: 0, loadFactor: 1, stalled: false,
    alphaFloor: false, autobrake: false, onGround: true,
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
  const ice = clamp(env.ice ?? 0, 0, 1);
  const wing = wingOf(flaps, spoilers, gear, mach, ice);
  // Rolling over ground too steep for it ends the flight; so does the gear coming up under it.
  const crash: Crash | null = gear < 0.99 ? "gear" : Math.abs(slope) > LANDING_LIMITS.slope && state.tas > 15 ? "terrain" : null;

  // The nose: lifted by the stick once there is air enough over the tail, let down again without it. Lifted off
  // the ground, that is: on a slope the wheels stand the aircraft as the slope does, and it rotates from there.
  const tilt = env.tilt ?? { pitch: 0, roll: 0 };
  const rotated = state.pitch - tilt.pitch;
  const authority = clamp(q / Q_ROTATION_PA - 0.5, 0, 1.2);
  const pitchDemand = input.pitch > 0 ? input.pitch * ROTATION_RATE * authority : -NOSE_FALLS * (rotated > 0 ? 1 : 0);
  const pitchRate = state.pitchRate + (pitchDemand - state.pitchRate) * lag(h, PITCH_LAG_S);
  const alpha = clamp(rotated + pitchRate * h, 0, TAIL_STRIKE);
  const pitch = alpha + tilt.pitch;

  const cl = liftAt(wing, alpha);
  const lift = q * WING_M2 * cl;
  const induced = wing.induced * cl * cl * groundEffect(WING_OVER_WHEELS_M);
  const drag = q * WING_M2 * (CD_ZERO + wing.drag + induced);
  const thrust = thrustAt(ground, state.tas) * Math.max(spool, IDLE_SPOOL) * (1 - (1 + REVERSE_SHARE) * reverse) * breathing(ice);
  const weight = WEIGHT_N * (1 + ICE_WEIGHT * ice);
  const mass = weight / G;
  const carried = Math.max(0, weight - lift);

  // The brakes: held, all of them; after a landing, as much as slows it steadily, less what the reversers already do.
  const autobrake = state.autobrake && throttle < 0.15 && !input.brake && state.tas > 1;
  const most = BRAKING * carried;
  const along = thrust - drag - ROLLING * carried - weight * slope;
  const braking = input.brake ? most : autobrake ? clamp(mass * AUTOBRAKE_MS2 + along, 0, most) : 0;
  let tas = state.tas + ((along - braking) / mass) * h;
  // Standing still is standing still: what holds it does not push it backwards.
  if (tas < 0.05 && along - braking <= 0) tas = 0;
  tas = Math.max(tas, 0);

  // The nose wheel steers: briskly at a walk, and no harder than the tyres hold at speed.
  const steering = Math.min(STEERING_RATE, tas > 1 ? (STEERING_G * G) / tas / RADIANS : STEERING_RATE) * Math.min(1, tas / 3);
  const heading = wrap360(state.heading + input.yaw * steering * h);
  // Both mains on the ground: the wings lean as it does across.
  const rolled = state.roll + (tilt.roll - state.roll) * lag(h, 0.3);
  const [lon, lat] = destination(state.lon, state.lat, heading, tas * h);

  const rolling: AircraftState = {
    lon, lat, altitude: ground, heading, pitch, roll: rolled, tas, flightPath: 0, track: heading, throttle, spool, reverse, rollRate: 0,
    pitchRate, flaps, spoilers, airUp: 0, alphaWanted: alpha, onGround: true, autobrake, touchdown: state.touchdown, crash,
    verticalSpeed: 0, alpha, loadFactor: 1, stalled: false, alphaFloor: false, slip: 0,
  };
  // Off again once the wing carries all of it: with thrust on, that is. Landed and at idle the gear has
  // taken the weight and the spoilers are on their way up, and it stays down.
  const staying = state.touchdown !== null && throttle < GO_AROUND;
  if (lift <= weight * LIFT_OFF || crash || staying) return rolling;
  return { ...rolling, onGround: false, touchdown: null, loadFactor: lift / weight, altitude: ground + 0.01 };
}

/** Where the aircraft will be in `seconds`, flying on as it is: straight, at its vertical speed. */
export function ahead(state: AircraftState, seconds: number, warp = 1): { lon: number; lat: number; altitude: number } {
  const travelled = state.tas * Math.cos(state.flightPath * RADIANS) * seconds * warp;
  const [lon, lat] = destination(state.lon, state.lat, state.track, travelled);
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
