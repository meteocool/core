import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advance, broken, BREAKUP_MACH, BREAKUP_MS, FLUTTER_CERTAIN_MS, FLUTTER_MS, harmed, intact, shown, shudder, SURFACES, surfacesLost,
} from "../../src/lib/studio/flight/damage.ts";
import type { Damage, DamageEvent, Flight } from "../../src/lib/studio/flight/damage.ts";
import { parseModel } from "../../src/lib/studio/flight/model.ts";
import { levelFlight, NO_INPUT, step, STILL_AIR, VMO_MS } from "../../src/lib/studio/flight/physics.ts";
import type { AircraftState, ControlInput, Environment, Lost } from "../../src/lib/studio/flight/physics.ts";
import type { LostSurface } from "../../src/lib/studio/store.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const KT = 0.514444;
const cruise = levelFlight(3, 43, 3000, 0, 150);
const speeds = (ias: number, mach = 0.6): Flight => ({ ias, mach, gear: 0, over: null });

/** The damage after `seconds` of a state held as it is, and what happened when. */
function held(state: AircraftState, seconds: number, flight: Flight, from: Damage = intact()) {
  let damage = from;
  const events: Array<DamageEvent & { at: number }> = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.02) {
    const next = advance(damage, state, flight, 0.02);
    damage = next.damage;
    events.push(...next.events.map((event) => ({ ...event, at: t + 0.02 })));
  }
  return { damage, events };
}

/* ---- what flutter takes first ---- */

test("past its flutter speed the surfaces go one at a time, in an order chance decides, and the flight goes on", () => {
  const fast = speeds(FLUTTER_MS + 8);
  const { damage, events } = held(cruise, 30, fast, intact(3));
  const lost = surfacesLost(damage);
  // Clean, with the speed brake in, it is the ailerons, the elevators and the rudder that can go: all of them, in time.
  assert.deepEqual([...lost].sort(), ["leftAileron", "leftElevator", "rightAileron", "rightElevator", "rudder"]);
  assert.deepEqual(events.map((event) => event.kind), ["shed", "shed", "shed", "shed", "shed"]);
  assert.deepEqual(events.map((event) => (event.kind === "shed" ? event.surface : null)), lost);
  assert.ok(events.every((event) => event.strength < 0.3), "a small bang each");
  assert.ok(!broken(damage) && damage.cause === null, "the airframe is whole, and the flight not over");
  // One at a time: no two in the same moment.
  for (let i = 1; i < events.length; i++) assert.ok(events[i].at - events[i - 1].at > 0.05);

  // The same flight loses them in the same order every time; another flight in another.
  assert.deepEqual(surfacesLost(held(cruise, 30, fast, intact(3)).damage), lost);
  const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => surfacesLost(held(cruise, 30, fast, intact(seed)).damage).join()));
  assert.ok(orders.size >= 6, `${orders.size} orders in 8 flights`);
  const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seed) => surfacesLost(held(cruise, 30, fast, intact(seed)).damage)[0]));
  assert.ok(firsts.size >= 4, `${firsts.size} first surfaces`);

  // Further past, they go sooner after each other.
  const gaps = (ias: number) => {
    let sum = 0;
    let count = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const at = held(cruise, 40, speeds(ias), intact(seed)).events.map((event) => event.at);
      for (let i = 1; i < at.length; i++) {
        sum += at[i] - at[i - 1];
        count += 1;
      }
    }
    return sum / count;
  };
  const slow = gaps(FLUTTER_MS + 2);
  const quick = gaps(FLUTTER_CERTAIN_MS);
  assert.ok(slow > 1.2 && quick < slow / 3, `${slow.toFixed(2)} s apart just past, ${quick.toFixed(2)} s far past`);
});

test("the spoilers, flaps and slats go only where they stand out in the air", () => {
  const fast = speeds(FLUTTER_MS + 8);
  const all = new Set<LostSurface>();
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const surface of surfacesLost(held(cruise, 30, fast, intact(seed)).damage)) all.add(surface);
  assert.ok(![...all].some((surface) => SURFACES[surface].out), [...all].join());
  const dirty = { ...cruise, flaps: 2, spoilers: 0.5 };
  const out = surfacesLost(held(dirty, 30, fast, intact(2)).damage);
  assert.equal(out.length, 11);
  assert.ok(["leftFlap", "rightSlat", "leftSpoiler"].every((surface) => out.includes(surface as LostSurface)));
});

test("each goes with a small bang and a puff of smoke where it was, tumbles off behind, and jolts the aircraft", () => {
  // The step it goes in.
  let damage = intact(5);
  while (!surfacesLost(damage).length) damage = advance(damage, cruise, speeds(FLUTTER_MS + 0.5), 0.02).damage;
  const [surface] = surfacesLost(damage);
  assert.ok(surface);
  const { part, centre, side } = SURFACES[surface];
  const fresh = shown(damage, cruise)!;
  // Off the airframe at once: drawn where it has got to, which is still about where it hung.
  const middle = (m: ArrayLike<number>) => [0, 1, 2].map((i) => m[i] * centre[0] + m[4 + i] * centre[1] + m[8 + i] * centre[2] + m[12 + i]);
  const now = middle(fresh.lost[part]!);
  assert.ok(Math.hypot(now[0] - centre[0], now[1] - centre[1], now[2] - centre[2]) < 3, `${now}`);
  assert.deepEqual(Object.keys(fresh.pieces), [], "nothing else has come off");
  const [blast] = fresh.effects.blasts;
  assert.ok(blast.size > 2 && blast.size < 6, `${blast.size} m across`);
  assert.deepEqual(blast.at, centre);
  const [smoke] = fresh.effects.fires;
  assert.deepEqual(smoke.at, centre);
  assert.ok(smoke.size < 2);
  // The jolt: hard at once, towards the side it left a wing on, and soon over.
  const jolt = shudder({ ...damage, clock: damage.jolt!.born });
  assert.ok(Math.abs(jolt.roll) > 5 && jolt.shake > 0.9, `${jolt.roll} °/s`);
  if (side && !surface.endsWith("Elevator")) assert.equal(Math.sign(jolt.roll), side);

  // A second on, it is far behind; a few more and it is let go of, though still not on the airframe; the smoke thins away.
  const later = held(cruise, 1, speeds(VMO_MS), damage).damage;
  assert.ok(middle(shown(later, cruise)!.lost[part]!)[0] < -50, "behind");
  assert.ok(shown(later, cruise)!.effects.fires[0].strength < smoke.strength);
  assert.ok(Math.abs(shudder(later).roll) < 2);
  const gone = held(cruise, 8, speeds(VMO_MS), later).damage;
  assert.equal(shown(gone, cruise)!.lost[part], null);
  assert.equal(shown(gone, cruise)!.effects.fires.length, 0);
  assert.equal(shown(gone, cruise)!.effects.blasts.length, 0);
  // What is left buffets in the air going past it, more the more has gone.
  assert.ok(gone.buffet > 0 && gone.buffet < 0.2);
});

test("the airframe itself goes only well past that: at once 90 kt past, over seconds a little short of it, quicker with its surfaces gone", () => {
  const certain = held(cruise, 10, speeds(FLUTTER_CERTAIN_MS + 2), intact(4)).damage;
  assert.equal(surfacesLost(certain).length, 5);
  assert.ok(!broken(certain), "60 kt past, it flies on without them");
  const at = (flight: Flight, seed: number, from: Damage = intact(seed)) => {
    const { events } = held(cruise, 60, flight, from);
    return events.find((event) => event.kind === "torn")?.at ?? Infinity;
  };
  assert.ok(at(speeds(BREAKUP_MS + 1), 1) < 0.5);
  assert.ok(at(speeds(160, BREAKUP_MACH + 0.002), 1) < 0.5);
  // Three quarters of the way there it holds for a good few seconds, and then goes.
  const between = FLUTTER_CERTAIN_MS + 0.75 * (BREAKUP_MS - FLUTTER_CERTAIN_MS);
  const lasted = at(speeds(between), 2);
  assert.ok(lasted > 4 && lasted < 20, `${lasted} s`);
  // A quarter of the way it lasts far longer with its surfaces on than with them gone.
  const quarter = FLUTTER_CERTAIN_MS + 0.25 * (BREAKUP_MS - FLUTTER_CERTAIN_MS);
  const bare = { ...certain, airframe: 0 };
  assert.ok(at(speeds(quarter), 2, bare) < 45, "bare");
  assert.ok(BREAKUP_MS - VMO_MS > 80 * KT && BREAKUP_MS - VMO_MS < 95 * KT);
  // Slowed down in time, the shaking dies away.
  const shaken = held(cruise, 3, speeds(between), intact(2)).damage;
  assert.ok(shaken.airframe > 0.1 && !broken(shaken));
  assert.equal(held(cruise, 5, speeds(VMO_MS), shaken).damage.airframe, 0);
  assert.ok(harmed(shaken));
});

/* ---- what the aircraft does without them ---- */

const without = (...surfaces: LostSurface[]): Environment => ({ ...STILL_AIR, lost: { surfaces } satisfies Lost });
function flown(seconds: number, input: ControlInput, env: Environment, state: AircraftState = cruise) {
  let rollRate = 0;
  let pitchRate = 0;
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    const next = step(state, input, 0.05, env);
    rollRate = Math.max(rollRate, Math.abs(next.roll - state.roll) / 0.05);
    pitchRate = Math.max(pitchRate, Math.abs(next.pitch - state.pitch) / 0.05);
    state = next;
  }
  return { state, rollRate, pitchRate };
}
const right = { ...NO_INPUT, roll: 1 };

test("an aileron gone halves the roll and rolls the aircraft towards it; with neither, only a spoiler rolls it, slowly", () => {
  const whole = flown(1.5, right, STILL_AIR).rollRate;
  near(whole, 25, 3);
  const one = flown(1.5, right, without("rightAileron")).rollRate;
  near(one, whole / 2 + 3, 2.5);
  // Hands off, it rolls towards the side that has lost its aileron, and keeps on rolling.
  assert.ok(flown(3, NO_INPUT, without("leftAileron")).state.roll < -5);
  assert.ok(flown(3, NO_INPUT, without("rightAileron")).state.roll > 5);
  const spoilers = flown(1.5, right, without("leftAileron", "rightAileron")).rollRate;
  near(spoilers, 0.3 * whole, 2);
  const bare = flown(1.5, right, without("leftAileron", "rightAileron", "rightSpoiler")).rollRate;
  assert.ok(bare < 3, `${bare} °/s`);
  // Left, that wing's spoiler is still there.
  near(flown(1.5, { ...NO_INPUT, roll: -1 }, without("leftAileron", "rightAileron", "rightSpoiler")).rollRate, spoilers, 2);
});

test("an elevator gone halves the pitch; with neither only the trim moves the nose, slowly, and the flight path wanders", () => {
  const pull = { ...NO_INPUT, pitch: 1 };
  const whole = flown(1, pull, STILL_AIR).pitchRate;
  const one = flown(1, pull, without("leftElevator")).pitchRate;
  assert.ok(one < whole * 0.7 && one > whole * 0.3, `${one} of ${whole}`);
  // One alone rolls it a little away from the side that has gone, and lets the nose down.
  assert.ok(flown(4, NO_INPUT, without("leftElevator")).state.roll > 1);
  assert.ok(flown(4, NO_INPUT, without("leftElevator")).state.flightPath < flown(4, NO_INPUT, STILL_AIR).state.flightPath);
  const none = flown(1, pull, without("leftElevator", "rightElevator")).pitchRate;
  assert.ok(none < whole * 0.2, `${none} of ${whole}`);
  // Hands off and faster than it was trimmed for, the fly-by-wire holds the path; on the trim alone it climbs away and back.
  const quick = { ...cruise, tas: cruise.tas + 12 };
  const held = flown(15, NO_INPUT, STILL_AIR, quick).state;
  assert.ok(Math.abs(held.flightPath) < 1.5, `path ${held.flightPath}`);
  let path = { most: -Infinity, least: Infinity };
  let state = quick;
  for (let t = 0; t < 60; t += 0.05) {
    state = step(state, NO_INPUT, 0.05, without("leftElevator", "rightElevator"));
    path = { most: Math.max(path.most, state.flightPath), least: Math.min(path.least, state.flightPath) };
  }
  assert.ok(path.most > 3 && path.least < -1, `path between ${path.least} and ${path.most}`);
});

test("without the rudder the pedals do nothing, and a gust sets the nose swinging that only slowly dies away", () => {
  const pedal = { ...NO_INPUT, yaw: 1 };
  assert.ok(Math.abs(flown(2, pedal, STILL_AIR).state.slip) > 3);
  assert.ok(Math.abs(flown(2, pedal, without("rudder")).state.slip) < 0.2);
  const kicked = (env: Environment) => {
    let state = cruise;
    const slips: number[] = [];
    for (let t = 0; t < 12; t += 0.05) {
      const gust = t < 0.4 ? { roll: 20, pitch: 0, vertical: 0 } : STILL_AIR.gust;
      state = step(state, NO_INPUT, 0.05, { ...env, gust });
      slips.push(state.slip);
    }
    const late = slips.slice(-100);
    const swings = late.filter((slip, i) => i > 0 && Math.sign(slip) !== Math.sign(late[i - 1])).length;
    return { swings, size: Math.max(...late.map(Math.abs)) };
  };
  const damped = kicked(STILL_AIR);
  const swinging = kicked(without("rudder"));
  assert.ok(swinging.swings >= 2 && swinging.size > 0.5, `${swinging.swings} swings, ${swinging.size}°`);
  assert.ok(damped.size < swinging.size / 3, `${damped.size}° with the yaw damper`);
});

test("with a surface gone the fly-by-wire protects nothing: it can be pulled past its limit load and pushed past its pitch limit", () => {
  const fast = levelFlight(3, 43, 3000, 0, 200);
  const most = (env: Environment) => {
    let state = fast;
    let load = 0;
    for (let t = 0; t < 3; t += 0.05) {
      state = step(state, { ...NO_INPUT, pitch: 1 }, 0.05, env);
      load = Math.max(load, state.loadFactor);
    }
    return load;
  };
  assert.ok(most(STILL_AIR) <= 2.55);
  assert.ok(most(without("rudder")) > 2.8, `${most(without("rudder"))} g`);
  const push = { ...NO_INPUT, pitch: -1 };
  assert.ok(flown(10, push, STILL_AIR, fast).state.pitch > -16);
  assert.ok(flown(10, push, without("rudder"), fast).state.pitch < -20);
  // Nor does it put the thrust up for it near the stall.
  const slow = levelFlight(3, 43, 3000, 0, 75);
  assert.ok(flown(6, { ...NO_INPUT, pitch: 1 }, without("rudder"), slow).state.stalled);
  assert.ok(!flown(6, { ...NO_INPUT, pitch: 1 }, STILL_AIR, slow).state.stalled);
});

test("each surface gone drags a little", () => {
  const whole = flown(20, NO_INPUT, STILL_AIR).state.tas;
  const bare = flown(20, NO_INPUT, without("leftElevator", "rightElevator", "leftAileron", "rightAileron", "rudder")).state.tas;
  assert.ok(bare < whole - 0.3, `${bare} against ${whole}`);
});

/* ---- the model ---- */

test("each surface names a part of the aircraft's model, and its middle is in that part", () => {
  const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
  const model = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const [surface, { part, centre }] of Object.entries(SURFACES)) {
    assert.ok(model.parts[part], `${surface}: ${part}`);
    const chunks = model.chunks.filter((chunk) => chunk.part === part);
    assert.ok(chunks.length, `${surface}: drawn`);
    assert.ok(chunks.some((chunk) => centre.every((value, axis) => value >= chunk.min[axis] - 0.3 && value <= chunk.min[axis] + chunk.size[axis] + 0.3)), surface);
  }
});
