/**
 * What breaks the aircraft, and what becomes of it once it has.
 *
 * An airframe is built to carry so much: a load factor it may be flown to
 * (the limit load) and half as much again before it fails (the ultimate);
 * a speed past which its wings and tail begin to shake themselves apart;
 * flaps and wheels that may hang in the air only so fast; and wing tips
 * and engines that are not for touching the ground. Each frame the flight
 * is held against these (`advance`), and what gives way comes off: a wing,
 * with its engine, or the tail. The physics is told what is missing
 * (`Damage.lost`, physics.ts) and flies what is left, which is a fall.
 *
 * A piece that has come off has a motion of its own: the air slows it far
 * faster than the aircraft it left, it tumbles, and it falls. Where the
 * flight ends on the ground and not on its wheels, how hard it came down
 * decides what happens there: a slide, with a wing torn off on the way and
 * fuel alight, or, coming down hard, a fireball and the pieces thrown from
 * it. `shown` is all of it as the aircraft's renderer draws it: the pieces,
 * each where it is now, and the fires and blasts.
 *
 * Pure and deterministic: what chance there is (which wing goes, how a
 * piece tumbles) comes from a seed carried in the damage itself, so the
 * same flight breaks the same way every time.
 *
 * Places are metres in the hull's frame, forward, right and down, measured
 * on the model as cockpit.ts's are; a piece in the air is kept north, east
 * and down of the hull.
 */
import type { AircraftEffects, AircraftPiece } from "../../../layers/aircraftRenderer";
import { BREAKS } from "./model";
import { dynamicPressure, FLAP_LIMIT_MS, G, GEAR_LIMIT_MS, turned, VMO_MS, WEIGHT_N, WING_M2 } from "./physics";
import type { AircraftState, Lost } from "./physics";
import { apply, attitudeOf, multiply, rotation, transpose } from "./view";
import type { Mat3, Vec3 } from "./view";

/**
 * The load factors the structure bears, g: clean and with the flaps out,
 * what it may be flown to and where it fails. Past the limit its margin is
 * used up, the faster the further past (by the square of how far towards
 * the ultimate), and held at the ultimate it is gone in `OVERSTRESS_S`.
 * What is used up does not come back.
 */
export const LOAD_LIMIT = { clean: [-1, 2.5], flaps: [0, 2] } as const;
export const LOAD_ULTIMATE = { clean: [-1.5, 3.75], flaps: [-0.75, 3] } as const;
export const OVERSTRESS_S = 0.3;
/** This far past the ultimate, both wings go at once. */
const BOTH_WINGS_FROM = 1.6;

/**
 * Flutter. Well past the fastest it may be flown (25 kt, or Mach 0.89)
 * the wings and tail begin to shake: there, something comes off after
 * `FLUTTER_S`; by 60 kt past, or Mach 0.96, at once. Slowed down again in
 * time, the shaking dies away.
 */
export const FLUTTER_MS = VMO_MS + 12.9;
export const FLUTTER_MACH = 0.89;
export const FLUTTER_CERTAIN_MS = VMO_MS + 30.9;
export const FLUTTER_CERTAIN_MACH = 0.96;
export const FLUTTER_S = 4;
const FLUTTER_FASTER = 15;
const FLUTTER_DIES_S = 2;
/** How often it is the tail that flutter takes, and not a wing. */
const FLUTTER_TAIL = 0.45;

/** The sideways load the fin bears, g, with the hull slipping through the air; and how long it bears more, seconds. */
export const FIN_LIMIT_G = 0.9;
const FIN_S = 0.4;
const CY_SLIP = 0.9;

/** The flaps and the gear jam where they are after this long, seconds, this many times faster than they may be out at. */
export const JAM_FROM = { flaps: 1.25, gear: 1.2 } as const;
const JAM_S = 3;

/**
 * Where the airframe would touch the ground first, on the right side (the
 * left is its mirror): the wing's tip and the bottom of the engine; and
 * the top of the fin, for an aircraft on its back. The engines hang lower
 * than the wheels reach only when it is banked past `POD_STRIKE`.
 */
const WING_TIP: Vec3 = [-4, 17, -0.5];
const ENGINE: Vec3 = [4.1, 6.2, 3.35];
const FIN_TOP: Vec3 = [-18.5, 0, -8];
const POD_STRIKE = 16;

/**
 * Each piece: about where its weight is, which it tumbles round (a wing's
 * is well inboard, where its engine and its fuel are); where it broke off
 * (model.ts draws the break there), which burns; how fast it falls once
 * the air has stopped it, m/s; and which way it is thrown as it leaves, m/s
 * in the hull's frame.
 */
const PIECES: Record<AircraftPiece, { centre: Vec3; root: Vec3; terminal: number; kick: Vec3 }> = {
  leftWing: { centre: [0.3, -6.5, 0.9], root: [-0.5, -BREAKS.wingRoot, 0.9], terminal: 48, kick: [-3, -5, -4] },
  rightWing: { centre: [0.3, 6.5, 0.9], root: [-0.5, BREAKS.wingRoot, 0.9], terminal: 48, kick: [-3, 5, -4] },
  tail: { centre: [-17, 0, -1.4], root: [BREAKS.tail, 0, -0.4], terminal: 40, kick: [-5, 0, -5] },
};
const ALL: AircraftPiece[] = ["leftWing", "rightWing", "tail"];

/** How long a piece is followed, seconds, and how far, metres. */
const DEBRIS_S = 30;
const DEBRIS_M = 4000;
/** How high a piece's middle lies over the ground it has come to rest on, metres. */
const LYING_M = 0.6;
/** How long a blast is kept, seconds: as long as it is drawn for. */
const BLAST_S = 8;
/**
 * How large things burn, metres across: an airliner's fuel going up where
 * it hits, from the least violent of those to the most, and what is left in
 * a wreck that slid going up later; and the fires, of a hull that has blown
 * up (its middle, and aft), of a wing's stump and the wing it left, and of
 * an engine dragged along the ground.
 */
const BLAST_M = [18, 35];
const AFTER_BLAST_M = 16;
const FIRE_M = { wreck: 8, aft: 5, stump: 5, wing: 3.5, engine: 3, slid: 7 };

/**
 * How hard a flight came down, 0 to 1: its sink rate against this many
 * m/s, and what speed it had over this, against that. From `BLAST_FROM` it
 * blows up where it hits; under it, it slides.
 */
const VIOLENT_SINK_MS = 40;
const VIOLENT_SPEED_MS = [80, 400];
export const BLAST_FROM = 0.35;
/** Of the speed a hull had as it blew up, its pieces keep this share for their own, and no more than this, m/s. */
const THROWN_ON = 0.12;
const THROWN_ON_MS = 15;
/** A slide this violent tears a wing off on the way; this violent, the tail too, and the fuel goes up once it has stopped. */
const SLIDE_SHEDS = 0.1;
const SLIDE_BURNS = 0.2;

const RADIANS = Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Why the aircraft first lost a part: more load than it bears, more speed, or the ground. */
export type Cause = "load" | "flutter" | "ground";

/** A piece that has come off, on its own way down. */
export interface Debris {
  piece: AircraftPiece;
  /** Its middle from the hull's, metres north, east and down; and how fast it moves through the air, m/s. */
  at: Vec3;
  velocity: Vec3;
  /** Its own attitude (from the model's frame to the world's), and how it tumbles: radians a second, about that direction. */
  turn: Mat3;
  spin: Vec3;
  /** When it came off, on the damage's clock; and whether it has come to rest on the ground. */
  born: number;
  resting: boolean;
}

/** A fire: on the hull or on a piece that has come off, at a place in the model's frame. */
export interface Fire {
  on: AircraftPiece | "hull";
  at: Vec3;
  size: number;
  strength: number;
  born: number;
}

/** A blast, where it went off: from the hull, metres north, east and down. */
export interface Blast {
  at: Vec3;
  size: number;
  born: number;
}

/** Something a wreck still has coming: a piece that tears off as it slides, or fuel that goes up. */
interface Coming {
  at: number;
  piece?: AircraftPiece;
  blast?: number;
}

export interface Damage {
  /** Seconds since the aircraft was whole: it only runs forward. */
  clock: number;
  seed: number;
  /** How much of each margin is used up, 0 to 1: the wings' under load, the airframe's in flutter, the fin's sideways. */
  stress: number;
  flutter: number;
  fin: number;
  /** The flaps and the gear, on their way to jamming, 0 to 1; and jammed. */
  flapStrain: number;
  gearStrain: number;
  flapsStuck: boolean;
  gearStuck: boolean;
  /** What has come off; and why the first of it did, where that was the end of the flight and not what followed from it. */
  lost: Lost;
  cause: Cause | null;
  debris: Debris[];
  fires: Fire[];
  blasts: Blast[];
  /** How hard it came down, once it has, 0 to 1; and what its wreck still has coming. */
  violence: number | null;
  coming: Coming[];
}

/** What happened in a step, for whoever makes the noise of it: how much of the aircraft went, or how large a blast, 0 to 1. */
export type DamageEvent =
  | { kind: "torn"; piece: AircraftPiece; strength: number }
  | { kind: "jammed"; strength: number }
  | { kind: "blast"; strength: number };

/** What the damage is held against, beside the aircraft's state. */
export interface Flight {
  /** Indicated airspeed, m/s, and Mach number. */
  ias: number;
  mach: number;
  /** How far the landing gear is down, 0 to 1. */
  gear: number;
  /** How far under the hull's middle the ground is, metres as the aircraft is drawn over it; null where it is not known. */
  over: number | null;
}

/** An aircraft with nothing wrong with it. */
export function intact(seed = 1): Damage {
  return {
    clock: 0, seed, stress: 0, flutter: 0, fin: 0, flapStrain: 0, gearStrain: 0, flapsStuck: false, gearStuck: false,
    lost: {}, cause: null, debris: [], fires: [], blasts: [], violence: null, coming: [],
  };
}

/** Whether anything has come off. */
export const broken = (damage: Damage): boolean => Boolean(damage.lost.leftWing || damage.lost.rightWing || damage.lost.tail);

/** The next number of the damage's own run of chance, 0 to 1. */
function chance(damage: Damage): number {
  damage.seed = (damage.seed + 0x6d2b79f5) | 0;
  let t = damage.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** How fast the hull moves, m/s north, east and down. */
function velocityOf(state: AircraftState): Vec3 {
  const level = state.tas * Math.cos(state.flightPath * RADIANS);
  return [level * Math.cos(state.track * RADIANS), level * Math.sin(state.track * RADIANS), -state.verticalSpeed];
}

/**
 * How far under the hull's middle a place on it is, metres, as the
 * aircraft is pitched and rolled.
 */
function below(state: Pick<AircraftState, "pitch" | "roll">, [x, y, z]: Vec3): number {
  const [sp, cp] = [Math.sin(state.pitch * RADIANS), Math.cos(state.pitch * RADIANS)];
  const [sr, cr] = [Math.sin(state.roll * RADIANS), Math.cos(state.roll * RADIANS)];
  return -sp * x + cp * (sr * y + cr * z);
}

/**
 * What of the airframe is in the ground, with it `over` metres under the
 * hull's middle: a wing whose tip is, or whose engine is with the aircraft
 * banked so far that the wheels would not have met it first; the tail,
 * where the fin is.
 */
export function struck(state: Pick<AircraftState, "pitch" | "roll">, over: number): AircraftPiece[] {
  const pieces: AircraftPiece[] = [];
  for (const [piece, side] of [["leftWing", -1], ["rightWing", 1]] as const) {
    const tip = below(state, [WING_TIP[0], WING_TIP[1] * side, WING_TIP[2]]);
    const engine = below(state, [ENGINE[0], ENGINE[1] * side, ENGINE[2]]);
    if (tip > over || (engine > over && state.roll * side > POD_STRIKE)) pieces.push(piece);
  }
  if (below(state, FIN_TOP) > over) pieces.push("tail");
  return pieces;
}

/**
 * How far past its limit load the structure is, with the flaps where they
 * are: 0 at the limit, 1 at the ultimate, more beyond; nothing short of it.
 */
export function overload(loadFactor: number, flaps: number): number {
  const config = flaps > 0.5 ? "flaps" : "clean";
  const [low, high] = LOAD_LIMIT[config];
  const [least, most] = LOAD_ULTIMATE[config];
  return Math.max(0, (loadFactor - high) / (most - high), (low - loadFactor) / (low - least));
}

/** How far into flutter a speed is: 0 where it begins, 1 where something comes off at once; nothing short of it. */
export function fluttering(ias: number, mach: number): number {
  return Math.max(0, (ias - FLUTTER_MS) / (FLUTTER_CERTAIN_MS - FLUTTER_MS), (mach - FLUTTER_MACH) / (FLUTTER_CERTAIN_MACH - FLUTTER_MACH));
}

/**
 * How hard a flight came down, 0 to 1, from its touchdown and why it was
 * not a landing: into a slope is into a wall, and one that came down in
 * pieces did not come down gently.
 */
export function violenceOf(state: AircraftState): number {
  const came = state.touchdown;
  const speed = came?.tas ?? state.tas;
  const plain = clamp((came?.sink ?? 0) / VIOLENT_SINK_MS + Math.max(0, speed - VIOLENT_SPEED_MS[0]) / VIOLENT_SPEED_MS[1], 0, 1);
  if (state.crash === "terrain") return Math.max(plain, clamp(speed / 160, 0.25, 1));
  if (state.crash === "breakup") return Math.max(plain, 0.4);
  return plain;
}

/**
 * Take a piece off: it leaves with the hull's speed and a push of its own,
 * tumbling, its stump alight if it held fuel. `cause` is why, for a piece
 * that went before the flight was over; a wreck's pieces have none. It is
 * pushed `thrown` times as hard as a piece that only lets go.
 */
function tear(damage: Damage, piece: AircraftPiece, state: AircraftState, cause: Cause | null, thrown = 1, onward = 0): void {
  if (damage.lost[piece]) return;
  damage.lost = { ...damage.lost, [piece]: true };
  damage.cause ??= cause;
  const hull = rotation(state);
  const { centre, root, kick } = PIECES[piece];
  const jitter = () => (chance(damage) - 0.5) * 2;
  const push = apply(hull, [kick[0] * thrown + jitter() * 2, kick[1] * thrown + jitter() * 2, kick[2] * thrown + jitter() * 2]);
  // What the hull is doing now, and `onward`, m/s: what a hull the ground has just stopped was doing, which its pieces still are.
  const going = velocityOf(state);
  const speed: Vec3 = [going[0] + onward * Math.cos(state.track * RADIANS), going[1] + onward * Math.sin(state.track * RADIANS), going[2]];
  // A wing tumbles mostly about its own length, the tail about the wings' line.
  const about: Vec3 = piece === "tail" ? [jitter(), 2 + chance(damage) * 2, jitter()] : [jitter(), (2.5 + chance(damage) * 2.5) * (jitter() < 0 ? -1 : 1), jitter() * 1.5];
  damage.debris = [...damage.debris, {
    piece, at: apply(hull, centre), velocity: [speed[0] + push[0], speed[1] + push[1], speed[2] + push[2]],
    turn: hull, spin: apply(hull, about), born: damage.clock, resting: false,
  }];
  if (piece !== "tail") {
    damage.fires = [
      ...damage.fires,
      { on: "hull", at: root, size: FIRE_M.stump, strength: 0.85, born: damage.clock },
      { on: piece, at: root, size: FIRE_M.wing, strength: 0.6, born: damage.clock },
    ];
  }
}

/** The structure in the air, a step on: what load, speed and the ground do to it. */
function strain(damage: Damage, state: AircraftState, flight: Flight, dt: number, events: DamageEvent[]): void {
  const wings = ALL.filter((piece) => piece !== "tail" && !damage.lost[piece]);
  const went = (piece: AircraftPiece, cause: Cause, strength: number) => {
    tear(damage, piece, state, cause);
    events.push({ kind: "torn", piece, strength });
  };

  // The wings under load: what each still carries is its own share of it, however many are left.
  const past = wings.length ? overload((state.loadFactor * 2) / wings.length, state.flaps) : 0;
  if (past > 0) {
    damage.stress = Math.min(1, damage.stress + (past * past * dt) / OVERSTRESS_S);
    if (damage.stress >= 1) {
      const first = wings[chance(damage) < 0.5 ? 0 : wings.length - 1];
      const both = past > BOTH_WINGS_FROM;
      for (const piece of both ? wings : [first]) went(piece, "load", both ? 1 : 0.8);
      // What is left has been through the same.
      damage.stress = 0.5;
    }
  }

  // Flutter: it builds past its speed, and dies away again short of it.
  const shaking = fluttering(flight.ias, flight.mach);
  if (shaking > 0) {
    damage.flutter = Math.min(1, damage.flutter + (dt * (1 + FLUTTER_FASTER * shaking * shaking)) / FLUTTER_S);
    if (damage.flutter >= 1) {
      const left = ALL.filter((piece) => !damage.lost[piece]);
      const wing = left.filter((piece) => piece !== "tail");
      const tail = !damage.lost.tail && (chance(damage) < FLUTTER_TAIL || !wing.length);
      const piece = tail ? "tail" : wing[chance(damage) < 0.5 ? 0 : wing.length - 1];
      if (piece) went(piece, "flutter", 0.8);
      damage.flutter = left.length > 1 ? 0.4 : 0;
    }
  } else {
    damage.flutter = Math.max(0, damage.flutter - dt / FLUTTER_DIES_S);
  }

  // The fin, with the hull sideways to a fast air.
  if (!damage.lost.tail) {
    const sideways = (dynamicPressure(state.altitude, state.tas) * WING_M2 * CY_SLIP * Math.abs(Math.sin(state.slip * RADIANS))) / WEIGHT_N;
    damage.fin = sideways > FIN_LIMIT_G ? damage.fin + dt / FIN_S : 0;
    if (damage.fin >= 1) went("tail", "load", 0.7);
  }

  // The flaps and the gear, hung out in far more air than they are for.
  const notch = Math.min(Math.ceil(clamp(state.flaps, 0, FLAP_LIMIT_MS.length - 1) - 1e-6), FLAP_LIMIT_MS.length - 1);
  const jams = (strain: number, stuck: boolean, out: boolean, limit: number): [number, boolean] => {
    if (stuck || !out || flight.ias <= limit) return [stuck ? 1 : Math.max(0, strain - dt / JAM_S), stuck];
    const next = strain + dt / JAM_S;
    if (next >= 1) events.push({ kind: "jammed", strength: 0.3 });
    return [Math.min(1, next), next >= 1];
  };
  [damage.flapStrain, damage.flapsStuck] = jams(damage.flapStrain, damage.flapsStuck, state.flaps > 0.2, FLAP_LIMIT_MS[notch] * JAM_FROM.flaps);
  [damage.gearStrain, damage.gearStuck] = jams(damage.gearStrain, damage.gearStuck, flight.gear > 0.05, GEAR_LIMIT_MS * JAM_FROM.gear);

  // A wing or the fin in the ground: it stays there.
  if (flight.over !== null) {
    for (const piece of struck(state, flight.over)) {
      if (damage.lost[piece]) continue;
      went(piece, "ground", 0.9);
    }
  }
}

/** The aircraft has just met the ground for good: what happens there. */
function impact(damage: Damage, state: AircraftState, flight: Flight, events: DamageEvent[]): void {
  const violence = violenceOf(state);
  damage.violence = violence;
  const came = state.touchdown;
  // A wing that was in the ground as it came down has come off, whatever else happens.
  if (came && flight.over !== null) {
    for (const piece of struck(came, flight.over)) {
      if (damage.lost[piece]) continue;
      tear(damage, piece, state, "ground", 0.5);
      events.push({ kind: "torn", piece, strength: 0.9 });
    }
  }
  const under: Vec3 = [0, 0, Math.max(0, (flight.over ?? 2) - 1)];
  if (violence >= BLAST_FROM) {
    // Hard: it goes up where it hits, and what was still on it is thrown clear.
    const size = BLAST_M[0] + ((BLAST_M[1] - BLAST_M[0]) * (violence - BLAST_FROM)) / (1 - BLAST_FROM);
    damage.blasts = [...damage.blasts, { at: under, size, born: damage.clock }];
    const carried = Math.min(THROWN_ON_MS, (came?.tas ?? 0) * THROWN_ON) * (0.6 + 0.8 * chance(damage));
    for (const piece of ALL) tear(damage, piece, state, null, 1.5 + 2 * violence, carried);
    damage.fires = [
      ...damage.fires.filter((fire) => fire.on !== "hull"),
      { on: "hull", at: [1, 0, 0.6], size: FIRE_M.wreck, strength: 1, born: damage.clock },
      { on: "hull", at: [-9, 0, 0.4], size: FIRE_M.aft, strength: 0.8, born: damage.clock },
    ];
    events.push({ kind: "blast", strength: violence });
    return;
  }
  // More gently, it slides: the engines drag along the ground and burn; hard enough, a wing tears off on the way, the
  // one it came down on first; harder still the tail goes too, and the fuel goes up once it has stopped.
  for (const side of [-1, 1]) {
    if (damage.lost[side < 0 ? "leftWing" : "rightWing"]) continue;
    damage.fires = [...damage.fires, { on: "hull", at: [ENGINE[0] - 2, ENGINE[1] * side, ENGINE[2] - 0.8], size: FIRE_M.engine, strength: 0.3 + violence, born: damage.clock }];
  }
  const lean = came?.roll ?? 0;
  const low: AircraftPiece = (Math.abs(lean) > 1 ? lean < 0 : chance(damage) < 0.5) ? "leftWing" : "rightWing";
  const sheds = violence > SLIDE_SHEDS || state.crash === "attitude";
  if (sheds && !damage.lost[low]) damage.coming = [...damage.coming, { at: damage.clock + 0.35 + 0.4 * chance(damage), piece: low }];
  if (violence > SLIDE_BURNS) {
    if (!damage.lost.tail) damage.coming = [...damage.coming, { at: damage.clock + 0.8 + 0.5 * chance(damage), piece: "tail" }];
    damage.coming = [...damage.coming, { at: damage.clock + 2.4 + chance(damage), blast: AFTER_BLAST_M }];
  }
}

/** What a wreck still had coming, as its time comes. */
function unfold(damage: Damage, state: AircraftState, events: DamageEvent[]): void {
  const due = damage.coming.filter((each) => each.at <= damage.clock);
  if (!due.length) return;
  damage.coming = damage.coming.filter((each) => each.at > damage.clock);
  for (const { piece, blast } of due) {
    if (piece && !damage.lost[piece]) {
      tear(damage, piece, state, null, 0.6);
      events.push({ kind: "torn", piece, strength: 0.6 });
    }
    if (blast) {
      // Where it burns hardest: a wing's stump, if one has gone.
      const stump = damage.fires.find((fire) => fire.on === "hull" && fire.strength > 0.8)?.at ?? [0, 0, 0.6];
      damage.blasts = [...damage.blasts, { at: apply(rotation(state), stump), size: blast, born: damage.clock }];
      damage.fires = [...damage.fires, { on: "hull", at: [0, 0, 0.6], size: FIRE_M.slid, strength: 1, born: damage.clock }];
      events.push({ kind: "blast", strength: 0.45 });
    }
  }
}

/** The pieces that have come off, a step on: slowed by the air, falling, tumbling, and stopped by the ground. */
function fall(damage: Damage, state: AircraftState, flight: Flight, dt: number): void {
  const hull = velocityOf(state);
  const floor = flight.over === null ? Infinity : flight.over - LYING_M;
  damage.debris = damage.debris.flatMap((piece) => {
    if (damage.clock - piece.born > DEBRIS_S || Math.hypot(...piece.at) > DEBRIS_M) return [];
    if (piece.resting) {
      // Lying where it stopped, as the hull slides on.
      return [{ ...piece, at: [piece.at[0] - hull[0] * dt, piece.at[1] - hull[1] * dt, floor] as Vec3 }];
    }
    const drag = G / PIECES[piece.piece].terminal ** 2;
    let { at, velocity, turn, spin } = piece;
    let resting = false;
    for (let left = dt; left > 1e-6 && !resting; left -= 0.02) {
      const h = Math.min(left, 0.02);
      const speed = Math.hypot(...velocity);
      // Never slowed by more than it has: a piece let go at an airliner's speed loses most of it in a second.
      const slowed = 1 / (1 + drag * speed * h);
      velocity = [velocity[0] * slowed, velocity[1] * slowed, velocity[2] * slowed + G * h];
      at = [at[0] + (velocity[0] - hull[0]) * h, at[1] + (velocity[1] - hull[1]) * h, at[2] + (velocity[2] - hull[2]) * h];
      turn = turned(turn, spin, h);
      if (at[2] < floor) continue;
      // The ground: it bounces once or twice, losing most of what it had, and then lies flat.
      at = [at[0], at[1], floor];
      if (velocity[2] > 4) {
        velocity = [velocity[0] * 0.55, velocity[1] * 0.55, -velocity[2] * 0.25];
        spin = [spin[0] * 0.5, spin[1] * 0.5, spin[2] * 0.5];
      } else if (Math.hypot(velocity[0], velocity[1]) > 1) {
        const grip = Math.max(0, 1 - (8 * h) / Math.hypot(velocity[0], velocity[1]));
        velocity = [velocity[0] * grip, velocity[1] * grip, 0];
        spin = [0, 0, spin[2] * 0.9];
      } else {
        resting = true;
        velocity = [0, 0, 0];
        spin = [0, 0, 0];
        turn = rotation({ heading: attitudeOf(turn).heading, pitch: 0, roll: piece.piece === "tail" ? 90 : 0 });
      }
    }
    return [{ ...piece, at, velocity, turn, spin, resting }];
  });
  // A blast stays where it went off, and so falls behind a hull that slides on.
  damage.blasts = damage.blasts
    .filter((blast) => damage.clock - blast.born < BLAST_S)
    .map((blast) => ({ ...blast, at: [blast.at[0] - hull[0] * dt, blast.at[1] - hull[1] * dt, blast.at[2] - hull[2] * dt] as Vec3 }));
  // A fire on a piece that is no longer followed is out of sight.
  damage.fires = damage.fires.filter((fire) => fire.on === "hull" || damage.debris.some((piece) => piece.piece === fire.on));
}

/**
 * The damage `dt` seconds on, for an aircraft now in `state`: what the
 * flight did to its structure, what the ground did, and where its pieces
 * have got to; and what happened on the way.
 */
export function advance(before: Damage, state: AircraftState, flight: Flight, dt: number): { damage: Damage; events: DamageEvent[] } {
  const damage: Damage = { ...before, clock: before.clock + Math.max(dt, 0) };
  const events: DamageEvent[] = [];
  if (dt <= 0) return { damage, events };
  if (state.crash) {
    if (damage.violence === null) impact(damage, state, flight, events);
    unfold(damage, state, events);
  } else if (!state.onGround) {
    strain(damage, state, flight, dt, events);
  }
  fall(damage, state, flight, dt);
  return { damage, events };
}

/** A piece's place as the renderer wants it: from where the model has it to where it is now, in the hull's frame, columns first. */
function placed(inward: Mat3, piece: Debris): { turn: Mat3; shift: Vec3; matrix: number[] } {
  const turn = multiply(inward, piece.turn);
  const middle = apply(piece.turn, PIECES[piece.piece].centre);
  const shift = apply(inward, [piece.at[0] - middle[0], piece.at[1] - middle[1], piece.at[2] - middle[2]]);
  return {
    turn, shift,
    matrix: [
      turn[0][0], turn[1][0], turn[2][0], 0,
      turn[0][1], turn[1][1], turn[2][1], 0,
      turn[0][2], turn[1][2], turn[2][2], 0,
      shift[0], shift[1], shift[2], 1,
    ],
  };
}

/**
 * The damage as the aircraft's renderer draws it (`AircraftView.pieces`
 * and `effects`), for a hull in `state`; null for an aircraft that is
 * whole and has nothing burning.
 */
export function shown(
  damage: Damage, state: AircraftState,
): { pieces: Partial<Record<AircraftPiece, number[] | null>>; effects: AircraftEffects } | null {
  if (!broken(damage) && !damage.fires.length && !damage.blasts.length) return null;
  const inward = transpose(rotation(state));
  const places = new Map(damage.debris.map((piece) => [piece.piece, placed(inward, piece)]));
  const pieces: Partial<Record<AircraftPiece, number[] | null>> = {};
  for (const piece of ALL) if (damage.lost[piece]) pieces[piece] = places.get(piece)?.matrix ?? null;
  const fires = damage.fires.map(({ on, at, size, strength, born }) => {
    const place = on === "hull" ? null : places.get(on);
    const moved = place ? apply(place.turn, at).map((value, i) => value + place.shift[i]) as Vec3 : at;
    return { at: moved, size, strength, born };
  });
  const speed = velocityOf(state);
  return {
    pieces,
    effects: {
      time: damage.clock,
      fires,
      blasts: damage.blasts.map(({ at, size, born }) => ({ at: apply(inward, at), size, born })),
      air: apply(inward, [-speed[0], -speed[1], -speed[2]]),
      up: apply(inward, [0, 0, -1]),
    },
  };
}
