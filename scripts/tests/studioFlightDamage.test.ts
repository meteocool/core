import assert from "node:assert/strict";
import test from "node:test";
import { indicatedFromTrue, machOf, speedOfSound, trueFromIndicated } from "../../src/lib/studio/flight/atmosphere.ts";
import {
  advance, BLAST_FROM, broken, BREAKUP_MS, FIN_LIMIT_G, FLUTTER_CERTAIN_MS, FLUTTER_MACH, FLUTTER_MS, FLUTTER_S, fluttering, harmed, intact, JAM_FROM,
  LOAD_LIMIT, LOAD_ULTIMATE, overload, OVERSTRESS_S, shown, struck, violenceOf,
} from "../../src/lib/studio/flight/damage.ts";
import type { Damage, DamageEvent, Flight } from "../../src/lib/studio/flight/damage.ts";
import { FLAP_LIMIT_MS, levelFlight, NO_INPUT, step, STILL_AIR, VMO_MS } from "../../src/lib/studio/flight/physics.ts";
import type { AircraftState, ControlInput, Environment } from "../../src/lib/studio/flight/physics.ts";
import { apply, rotation } from "../../src/lib/studio/flight/view.ts";
import { roughAir } from "../../src/lib/studio/flight/weather.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

const KT = 0.514444;
/** What the damage is held against for a state: its own speeds, gear up, and the ground a long way down. */
const flightOf = (state: AircraftState, over: number | null = null): Flight => ({
  ias: indicatedFromTrue(state.tas, state.altitude), mach: machOf(state.tas, state.altitude), gear: 0, over,
});
/** The damage after `seconds` of a state that stays as it is. */
function held(state: AircraftState, seconds: number, flight: Flight = flightOf(state), from: Damage = intact()) {
  let damage = from;
  const events: DamageEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.02) {
    const next = advance(damage, state, flight, 0.02);
    damage = next.damage;
    events.push(...next.events);
  }
  return { damage, events };
}
/** The damage when the first thing happens to a state that stays as it is, and how long that took; within a minute. */
function first(state: AircraftState, flight: Flight = flightOf(state), from: Damage = intact()) {
  let damage = from;
  for (let seconds = 0.02; seconds < 60; seconds += 0.02) {
    const next = advance(damage, state, flight, 0.02);
    damage = next.damage;
    if (next.events.length) return { damage, events: next.events, seconds };
  }
  return { damage, events: [] as DamageEvent[], seconds: Infinity };
}
const cruise = levelFlight(3, 43, 3000, 0, 150);

/* ---- the limits ---- */

test("the structure's margin begins at the limit load and is gone at the ultimate, sooner with the flaps out and pushed the other way", () => {
  assert.equal(overload(1, 0), 0);
  assert.equal(overload(LOAD_LIMIT.clean[1], 0), 0);
  near(overload(LOAD_ULTIMATE.clean[1], 0), 1, 1e-9);
  near(overload(3.125, 0), 0.5, 1e-9);
  assert.equal(overload(LOAD_LIMIT.clean[0], 0), 0);
  near(overload(LOAD_ULTIMATE.clean[0], 0), 1, 1e-9);
  // What a clean wing bears, one with the flaps out does not.
  assert.equal(overload(2.4, 0), 0);
  assert.ok(overload(2.4, 2) > 0.3);
  assert.ok(overload(-0.5, 0) === 0 && overload(-0.5, 4) > 0.5);
});

test("flutter begins 25 kt or so past the fastest it may be flown, or at Mach 0.89, and is certain well beyond", () => {
  assert.equal(fluttering(VMO_MS, 0.6), 0);
  assert.equal(fluttering(VMO_MS + 20 * KT, 0.82), 0);
  assert.ok(fluttering(VMO_MS + 30 * KT, 0.6) > 0 && fluttering(VMO_MS + 30 * KT, 0.6) < 0.3);
  near(fluttering(FLUTTER_MS, FLUTTER_MACH), 0, 1e-9);
  assert.ok(fluttering(120, 0.9) > 0);
  near(fluttering(FLUTTER_CERTAIN_MS, 0.5), 1, 1e-9);
});

test("held at the limit load nothing gives; at the ultimate a wing is gone in a moment, and far past it both", () => {
  const at = (loadFactor: number) => ({ ...cruise, loadFactor });
  const fine = held(at(LOAD_LIMIT.clean[1]), 60);
  assert.equal(fine.damage.stress, 0);
  assert.ok(!broken(fine.damage));

  const short = held(at(LOAD_ULTIMATE.clean[1]), OVERSTRESS_S - 0.06);
  assert.ok(!broken(short.damage) && short.damage.stress > 0.7);
  const { damage, events, seconds } = first(at(LOAD_ULTIMATE.clean[1]));
  near(seconds, OVERSTRESS_S, 0.03);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "torn");
  assert.ok(damage.lost.leftWing !== damage.lost.rightWing, "one wing, not both");
  assert.equal(damage.cause, "load");
  assert.equal(damage.debris.length, 1);
  // The wing that is left carries on its own what the two carried: half the load is as much again for it.
  assert.ok(first(at(LOAD_ULTIMATE.clean[1] / 2), flightOf(cruise), damage).seconds < 0.3);
  assert.equal(first(at(1.2), flightOf(cruise), damage).seconds, Infinity);

  // Half way to the ultimate takes four times as long; what is used up stays used up.
  const half = held(at(3.125), OVERSTRESS_S * 2);
  near(half.damage.stress, 0.5, 0.05);
  near(held(at(1), 30, flightOf(cruise), half.damage).damage.stress, half.damage.stress, 1e-9);

  const both = first(at(6));
  assert.ok(both.damage.lost.leftWing && both.damage.lost.rightWing && both.seconds < 0.1);
  // Pushed too far the other way, the same.
  assert.ok(first(at(-2)).seconds < 0.4);
  // With the flaps out it fails at a load a clean wing may be flown to.
  assert.ok(first({ ...at(2.4), flaps: 2 }).seconds < 3);
  assert.equal(first(at(2.4)).seconds, Infinity);
});

test("the same flight breaks the same way every time, and another may break the other way", () => {
  const over = { ...cruise, loadFactor: 4 };
  assert.deepEqual(held(over, 1, flightOf(over), intact(3)).damage, held(over, 1, flightOf(over), intact(3)).damage);
  const sides = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => (first(over, flightOf(over), intact(seed)).damage.lost.leftWing ? "left" : "right")));
  assert.equal(sides.size, 2);
});

test("past its flutter speed a surface comes off after a few seconds, far past it at once; slowed down in time, nothing does", () => {
  const speeds = (ias: number): Flight => ({ ias, mach: 0.6, gear: 0, over: null });
  const edge = FLUTTER_MS + 0.5;
  const before = held(cruise, FLUTTER_S - 0.5, speeds(edge));
  assert.ok(!harmed(before.damage) && before.damage.flutter > 0.7);
  const after = first(cruise, speeds(edge));
  near(after.seconds, FLUTTER_S, 0.2);
  assert.deepEqual(after.events.map((event) => event.kind), ["shed"]);
  assert.ok(!broken(after.damage) && after.damage.cause === null, "a surface, not the flight's end");
  assert.ok(first(cruise, speeds(FLUTTER_CERTAIN_MS + 5)).seconds < 0.3);
  near(first(cruise, { ias: 150, mach: FLUTTER_MACH + 0.002, gear: 0, over: null }).seconds, FLUTTER_S, 0.3);
  // The shaking dies away again.
  const saved = held(cruise, 6, speeds(VMO_MS), before.damage);
  assert.equal(saved.damage.flutter, 0);
  assert.ok(!harmed(saved.damage));
  // Far beyond, the airframe itself: the tail as often as a wing, near enough, and that ends the flight.
  const pieces = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) => {
    const { damage, events } = held(cruise, 1, speeds(BREAKUP_MS + 2), intact(seed));
    assert.equal(damage.cause, "flutter");
    const torn = events.find((event) => event.kind === "torn");
    return torn?.kind === "torn" && torn.piece === "tail" ? "tail" : "wing";
  }));
  assert.equal(pieces.size, 2);
});

test("a hull sideways to fast air loses its fin; the flaps and the gear jam hung out in far too much of it", () => {
  const fast = levelFlight(3, 43, 2000, 0, 190);
  assert.ok(!broken(held({ ...fast, slip: 4 }, 5).damage), "what the rudder can hold, the fin bears");
  const sideways = held({ ...fast, slip: 40 }, 1);
  assert.ok(sideways.damage.lost.tail && !sideways.damage.lost.leftWing);
  assert.ok(FIN_LIMIT_G > 0.5);

  const dirty = { ...levelFlight(3, 43, 1000, 0, 100, { flaps: 4 }) };
  const out = (ias: number, gear = 0): Flight => ({ ias, mach: 0.3, gear, over: null });
  assert.ok(!held(dirty, 20, out(FLAP_LIMIT_MS[4] * 1.1)).damage.flapsStuck, "over the limit is a warning, not a jam");
  const jammed = held(dirty, 4, out(FLAP_LIMIT_MS[4] * JAM_FROM.flaps + 2));
  assert.ok(jammed.damage.flapsStuck && !jammed.damage.gearStuck);
  assert.deepEqual(jammed.events.map((event) => event.kind), ["jammed"]);
  assert.ok(held(cruise, 4, out(180, 1)).damage.gearStuck);
  assert.ok(!held(cruise, 4, out(180, 0)).damage.gearStuck, "up, it is out of the wind");
  // Jammed flaps stay where they are, whatever the lever says.
  const stuck = { ...STILL_AIR, flapLever: 0, flapsStuck: true };
  let state: AircraftState = dirty;
  for (let t = 0; t < 20; t += 0.05) state = step(state, NO_INPUT, 0.05, stuck);
  assert.equal(state.flaps, 4);
});

/* ---- the ground ---- */

test("a wing is in the ground where its tip is, or its engine with the aircraft banked too far for the wheels to meet it first", () => {
  const level = { pitch: 3, roll: 0 };
  // Standing on its wheels, 4.1 m under its middle; and on its belly, where the engines carry it.
  assert.deepEqual(struck(level, 4.1), []);
  assert.deepEqual(struck(level, 2.3), []);
  assert.deepEqual(struck({ pitch: 3, roll: 8 }, 4.1), []);
  assert.deepEqual(struck({ pitch: 3, roll: 20 }, 4.1), ["rightWing"]);
  assert.deepEqual(struck({ pitch: 3, roll: -20 }, 4.1), ["leftWing"]);
  // In a steep turn the tip reaches most of a wing's length down.
  assert.deepEqual(struck({ pitch: 0, roll: 60 }, 16), []);
  assert.deepEqual(struck({ pitch: 0, roll: 60 }, 14), ["rightWing"]);
  // On its back, it is the fin that is lowest.
  assert.deepEqual(struck({ pitch: 0, roll: 180 }, 7), ["tail"]);
});

/** Fly `state` until it has come to rest on the ground, the damage with it; the ground at sea level. */
function down(state: AircraftState, input: ControlInput = NO_INPUT, env: Partial<Environment> = {}, seed = 1) {
  let damage = intact(seed);
  const events: DamageEvent[] = [];
  let seconds = 0;
  for (; seconds < 240; seconds += 0.05) {
    // As the pilot has it: the aircraft stands with its middle 4.1 m over the ground as it is drawn (taller than life, by
    // half), a wreck lies with it 2.3 m over it, and the damage is told how far down the ground is in those metres.
    const stepped = step(state, input, 0.05, { ...STILL_AIR, ground: state.crash ? (2.3 - 4.1) / 1.5 : 0, lost: damage.lost, ...env });
    const next = advance(damage, stepped, { ...flightOf(stepped, stepped.altitude * 1.5 + 4.1), gear: env.gear ?? 0 }, 0.05);
    state = stepped;
    damage = next.damage;
    events.push(...next.events);
    for (const value of [state.pitch, state.roll, state.heading, state.tas, state.altitude, state.alpha, state.loadFactor, state.lon, state.lat]) {
      assert.ok(Number.isFinite(value), `not a number at ${seconds} s`);
    }
    if (state.crash && state.tas === 0 && !damage.coming.length && damage.debris.every((piece) => piece.resting)) break;
  }
  return { state, damage, events, seconds };
}

test("down on its belly it slides and burns at the engines, and nothing blows up", () => {
  const approach = levelFlight(3, 43, 30, 0, 72, { flaps: 4, path: -2 });
  const { state, damage, events } = down(approach, NO_INPUT, { flapLever: 4 });
  assert.equal(state.crash, "gear");
  assert.ok(damage.violence !== null && damage.violence < BLAST_FROM, `violence ${damage.violence}`);
  assert.equal(damage.blasts.length, 0);
  assert.ok(damage.fires.length >= 2);
  assert.equal(damage.cause, null);
  assert.ok(!events.some((event) => event.kind === "blast"));
  assert.equal(state.tas, 0);
});

test("flown into the ground it goes up where it hits, and what was on it is thrown clear and comes to rest", () => {
  const dive = levelFlight(3, 43, 600, 0, 160, { path: -35 });
  const { state, damage, events } = down(dive);
  assert.equal(state.crash, "hard");
  assert.ok(violenceOf(state) > 0.9);
  assert.equal(damage.blasts.length, 1);
  assert.ok(damage.blasts[0].size > 30 && damage.blasts[0].size <= 35, `${damage.blasts[0].size} m across`);
  assert.ok(damage.fires.every((fire) => fire.size >= 3 && fire.size <= 8));
  assert.deepEqual(events.filter((event) => event.kind === "blast").map((event) => event.strength > 0.9), [true]);
  assert.ok(damage.lost.leftWing && damage.lost.rightWing && damage.lost.tail);
  assert.equal(damage.cause, null, "it broke because it hit the ground, not before");
  assert.equal(damage.debris.length, 3);
  for (const piece of damage.debris) {
    assert.ok(piece.resting);
    // The wings out to their sides; the tail, thrown back off a hull that was going forward, may lie beside it.
    const away = Math.hypot(piece.at[0], piece.at[1]);
    assert.ok((piece.piece === "tail" || away > 10) && away < 200, `${piece.piece} ${away} m off`);
    // Lying on the ground the hull lies on.
    near(piece.at[2], 2.3 - 0.6, 1e-6);
  }
  const seen = shown(damage, state)!;
  assert.ok(seen.effects.fires.some((fire) => fire.strength === 1));
  // Nothing goes past a wreck that has stopped.
  assert.deepEqual(seen.effects.air.map((value) => Math.abs(value)), [0, 0, 0]);
});

test("a hard landing slides, sheds the wing it came down on, and the fuel goes up once it has stopped", () => {
  const hard = { ...levelFlight(3, 43, 40, 0, 75, { flaps: 4, gear: 1, path: -7 }), roll: -5 };
  const { state, damage, events } = down(hard, NO_INPUT, { gear: 1, flapLever: 4 });
  assert.equal(state.crash, "hard");
  assert.ok(damage.violence! > 0.2 && damage.violence! < BLAST_FROM, `violence ${damage.violence}`);
  assert.ok(damage.lost.leftWing && !damage.lost.rightWing);
  const kinds = events.map((event) => event.kind);
  assert.ok(kinds.indexOf("torn") >= 0 && kinds.indexOf("blast") > kinds.indexOf("torn"), kinds.join());
  assert.ok(events.find((event) => event.kind === "blast")!.strength < 0.6);
});

test("a wing low over the ground is torn off by it, and that is why the flight ended", () => {
  // Banked hard, thirty metres up: the tip finds the ground before the wheels can.
  let banked = levelFlight(3, 43, 25, 0, 80, { flaps: 3 });
  banked = { ...banked, roll: 55 };
  const { state, damage, events } = down(banked, NO_INPUT, { flapLever: 3 });
  const first = events[0];
  assert.ok(first.kind === "torn" && first.piece === "rightWing");
  assert.equal(damage.cause, "ground");
  assert.equal(state.crash, "breakup");
  // A touchdown with a wing far down takes the wing too.
  const low = { ...levelFlight(3, 43, 0.5, 0, 71, { flaps: 4, gear: 1, path: -1 }), roll: 19 };
  const touched = down(low, NO_INPUT, { gear: 1, flapLever: 4 });
  assert.equal(touched.damage.cause, "ground");
  assert.ok(touched.damage.lost.rightWing);
  // One only a little down does not: that is a bad landing, not a wing strike.
  const slight = { ...levelFlight(3, 43, 0.5, 0, 71, { flaps: 4, gear: 1, path: -1 }), roll: 10 };
  const scraped = down(slight, NO_INPUT, { gear: 1, flapLever: 4 });
  assert.equal(scraped.state.crash, "attitude");
  assert.equal(scraped.damage.cause, null);
});

/* ---- the pieces ---- */

test("a piece that comes off is where the model has it at first, then falls behind and below, tumbling, and is let go of in the end", () => {
  const over = { ...cruise, loadFactor: 5, roll: 20, pitch: 4 };
  let { damage } = first({ ...over, loadFactor: 3.8 }, flightOf(over), intact(2));
  const piece = damage.lost.leftWing ? "leftWing" : "rightWing";
  // The step it came off in, it has hardly moved: its matrix is next to none.
  const fresh = held({ ...over, loadFactor: 3.8 }, 0.02, flightOf(over), { ...intact(2), stress: 0.999 });
  const matrix = shown(fresh.damage, over)!.pieces[piece]!;
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].forEach((value, i) => near(matrix[i], value, 0.12));
  assert.ok(Math.hypot(matrix[12], matrix[13], matrix[14]) < 3);
  assert.equal(shown(fresh.damage, over)!.pieces[piece === "leftWing" ? "rightWing" : "leftWing"], undefined, "the other wing is still on");

  const flying = { ...cruise, loadFactor: 1 };
  damage = held(flying, 2.6, flightOf(flying), damage).damage;
  const seen = shown(damage, flying)!;
  const [forward, , below] = [seen.pieces[piece]![12], seen.pieces[piece]![13], seen.pieces[piece]![14]];
  assert.ok(forward < -150, `${forward} m ahead`);
  assert.ok(below > 10, `${below} m down`);
  // Still a rigid piece: its three axes are unit lengths at right angles.
  const m = seen.pieces[piece]!;
  const column = (i: number) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const i of [0, 1, 2]) near(dot(column(i), column(i)), 1, 1e-9);
  near(dot(column(0), column(1)), 0, 1e-9);
  near(dot(column(1), column(2)), 0, 1e-9);
  assert.ok(Math.abs(m[0]) < 0.999, "it has turned");
  // The stump burns on the hull, where the wing was; the wing burns where it has got to.
  const fires = seen.effects.fires;
  assert.equal(fires.length, 2);
  near(Math.abs(fires[0].at[1]), 2.15, 1e-9);
  assert.ok(fires[1].at[0] < -100);
  // Half a minute on it is out of sight: named as gone, and not drawn.
  const gone = shown(held(flying, 31, flightOf(flying), damage).damage, flying)!;
  assert.equal(gone.pieces[piece], null);
  assert.equal(gone.effects.fires.length, 1);
});

test("what the renderer is given is in the hull's own frame: up is up as the hull has it, and the air comes from ahead", () => {
  assert.equal(shown(intact(), cruise), null);
  const banked = { ...cruise, roll: 90, pitch: 0, heading: 0, track: 0, flightPath: 0, verticalSpeed: 0, loadFactor: 5 };
  const { damage } = held(banked, 0.2);
  const { effects } = shown(damage, banked)!;
  // Rolled onto its right side, up is out along the left wing.
  near(effects.up[0], 0, 1e-9);
  near(effects.up[1], -1, 1e-9);
  near(effects.up[2], 0, 1e-9);
  near(effects.air[0], -banked.tas, 1e-6);
  near(Math.hypot(effects.air[1], effects.air[2]), 0, 1e-6);
  near(effects.time, damage.clock, 1e-12);
  assert.ok(effects.fires.every((fire) => fire.born <= effects.time));
  // A blast stays where it went off as the hull goes on.
  const wreck = { ...banked, roll: 0, loadFactor: 1, crash: "hard" as const, onGround: true, tas: 20, touchdown: { sink: 30, tas: 100, pitch: 0, roll: 0, load: 13 } };
  const blown = held(wreck, 1, flightOf(wreck, 2.3));
  near(shown(blown.damage, wreck)!.effects.blasts[0].at[0], -20, 0.5);
  near(apply(rotation(wreck), shown(blown.damage, wreck)!.effects.up)[2], -1, 1e-9);
});

/* ---- what is left flies as it would ---- */

test("with a wing gone it rolls towards the stump whatever the stick says, and falls; it comes down in pieces", () => {
  const env: Environment = { ...STILL_AIR, lost: { leftWing: true } };
  let state: AircraftState = levelFlight(3, 43, 3000, 0, 150);
  let turned = 0;
  for (let t = 0; t < 3; t += 0.05) {
    const next = step(state, { ...NO_INPUT, roll: 1, pitch: 1 }, 0.05, env);
    turned += ((next.roll - state.roll + 540) % 360) - 180;
    state = next;
  }
  assert.ok(turned < -180, `rolled ${turned} degrees`);
  assert.ok(state.flightPath < -5, `path ${state.flightPath}`);
  assert.ok(!state.alphaFloor);
  const { state: wreck, damage } = down(levelFlight(3, 43, 1500, 0, 150), NO_INPUT, {}, 4);
  assert.equal(wreck.crash, null, "whole, it flies on");
  assert.ok(!broken(damage));
  let lost = intact(4);
  lost = { ...lost, lost: { leftWing: true }, cause: "load" };
  let falling: AircraftState = levelFlight(3, 43, 1500, 0, 150);
  for (let t = 0; t < 120 && !falling.crash; t += 0.05) falling = step(falling, NO_INPUT, 0.05, { ...STILL_AIR, ground: 0, lost: lost.lost });
  assert.equal(falling.crash, "breakup");
});

test("with the tail gone the nose tucks under and nothing the stick does lifts it; with both wings gone it is a dart", () => {
  const env: Environment = { ...STILL_AIR, lost: { tail: true } };
  let state: AircraftState = levelFlight(3, 43, 3000, 0, 150);
  for (let t = 0; t < 1.5; t += 0.05) state = step(state, { ...NO_INPUT, pitch: 1, yaw: 1 }, 0.05, env);
  assert.ok(state.pitch < -25, `nose at ${state.pitch}`);
  assert.ok(state.loadFactor < 0, `at ${state.loadFactor} g`);
  let dart: AircraftState = levelFlight(3, 43, 3000, 0, 150);
  for (let t = 0; t < 15; t += 0.05) dart = step(dart, { ...NO_INPUT, roll: 1, throttle: 1 }, 0.05, { ...STILL_AIR, lost: { leftWing: true, rightWing: true } });
  assert.ok(dart.flightPath < -35, `path ${dart.flightPath}`);
  assert.ok(Math.abs(dart.loadFactor) < 0.4);
  near(dart.roll, 0, 1);
  assert.ok(dart.tas > 150, "and no engines to hold it back or up");
});

/* ---- a storm's core ---- */

/**
 * Through the worst core there is for forty seconds, hands off, at an
 * indicated airspeed and a height: what the airframe has left after it,
 * over a dozen stretches of the same rough air.
 */
function throughCore(knots: number, altitude: number, severity = 1) {
  let broke = 0;
  let stress = 0;
  let most = 0;
  for (let run = 0; run < 12; run += 1) {
    let state: AircraftState = levelFlight(3, 43, altitude, 0, trueFromIndicated(knots * KT, altitude));
    let damage = intact(run + 1);
    for (let t = 0; t < 40; t += 0.05) {
      const gust = roughAir(run * 53 + t, 1, 30, severity);
      state = step(state, NO_INPUT, 0.05, { ...STILL_AIR, gust, lost: damage.lost });
      damage = advance(damage, state, flightOf(state), 0.05).damage;
      most = Math.max(most, state.loadFactor);
    }
    broke += broken(damage) ? 1 : 0;
    stress += damage.stress / 12;
  }
  return { broke, stress, most };
}

test("flown fast into the heaviest core the airframe is loaded past its limit and breaks; slowed down for it, it comes through", () => {
  const fast = throughCore(340, 3000);
  assert.ok(fast.most > LOAD_LIMIT.clean[1] + 0.8, `as much as ${fast.most} g`);
  assert.ok(fast.broke >= 4, `broke up ${fast.broke} times in 12`);
  // At the speed rough air is flown at, the wing lets go of the air before the load can build: nothing breaks.
  const slow = throughCore(250, 3000);
  assert.equal(slow.broke, 0);
  assert.ok(slow.stress < 0.05, `used ${slow.stress}`);
  assert.ok(slow.most < LOAD_LIMIT.clean[1] + 0.5, `as much as ${slow.most} g`);
  // Fast, in air that is only rough: loaded, and whole.
  const rough = throughCore(340, 3000, 0);
  assert.equal(rough.broke, 0);
  assert.ok(rough.stress < 0.2, `used ${rough.stress}`);
  assert.ok(machOf(trueFromIndicated(340 * KT, 3000), 3000) < 0.82 && speedOfSound(3000) > 300);
});
