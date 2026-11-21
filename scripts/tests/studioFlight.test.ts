import assert from "node:assert/strict";
import test from "node:test";
import { bearingDeg, destination, distanceM, offsetM, wrap180, wrap360 } from "../../src/lib/studio/flight/geo.ts";
import {
  densityRatio, indicatedFromTrue, machOf, speedOfSound, temperatureK, trueFromIndicated,
} from "../../src/lib/studio/flight/atmosphere.ts";
import {
  ahead, FLAP_NOTCH_S, LANDING_LIMITS, levelFlight, NO_INPUT, parked, PITCH_DOWN_LIMIT, PITCH_UP_LIMIT, ROLL_RATE,
  SPEEDBRAKE, speedsFor, step, STILL_AIR, TAIL_STRIKE, terrainAhead, trimThrottle,
} from "../../src/lib/studio/flight/physics.ts";
import type { AircraftState, ControlInput, Environment } from "../../src/lib/studio/flight/physics.ts";
import {
  approachTo, chooseApproach, edgeKm, MAX_START_KM, rankSystems, reliefAt, START_ALTITUDE_M, START_KM, startAltitude, stormSystems, SUN_BEARING,
} from "../../src/lib/studio/flight/spawn.ts";
import type { StormTile } from "../../src/lib/studio/flight/spawn.ts";
import { flightFine, flightWanted } from "../../src/lib/studio/flight/selection.ts";
import type { CoarsePlace } from "../../src/lib/studio/flight/selection.ts";
import { cloudOf, gustAt, rainOf, reflectivityAt, turbulenceOf } from "../../src/lib/studio/flight/weather.ts";
import { actionOf, controlInput, gamepadInput, isFlightKey, merged } from "../../src/lib/studio/flight/controls.ts";
import { screenRect } from "../../src/layers/cellVolumeLayer.ts";
import { attitudeOf, cockpitEye, inAircraft, outsideEye, rotation, seenFrom } from "../../src/lib/studio/flight/view.ts";
import { coresOf, flatOffset, markAltitude, marksNear } from "../../src/lib/studio/flight/marks.ts";
import { BASE_RANGE_KM, cloudBase, condensationLevel } from "../../src/lib/studio/flight/cloudBase.ts";
import { parseModel, VERTEX_BYTES } from "../../src/lib/studio/flight/model.ts";
import {
  ALTITUDE_RANGE, approachOf, atMach, briefing, flightLevel, headed, highGround, levelled, machRange, movedTo, planFrom, position,
  retargeted, weatherOf,
} from "../../src/lib/studio/flight/plan.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/* ---- geo ---- */

test("a degree of latitude is 111 km, and a destination comes back as its distance and bearing", () => {
  near(distanceM(10, 45, 10, 46), 111_195, 5);
  const [lon, lat] = destination(3, 43, 72, 150_000);
  near(distanceM(3, 43, lon, lat), 150_000, 1);
  near(bearingDeg(3, 43, lon, lat), 72, 0.01);
  const [east, north] = offsetM(3, 43, ...destination(3, 43, 90, 10_000));
  near(east, 10_000, 5);
  near(north, 0, 10);
});

test("angles fold into a turn and into a compass", () => {
  assert.equal(wrap360(-30), 330);
  assert.equal(wrap360(725), 5);
  assert.equal(wrap180(270), -90);
  assert.equal(wrap180(-190), 170);
  assert.equal(wrap180(180), 180);
});

/* ---- atmosphere ---- */

test("the standard atmosphere: -56.5 C above the tropopause, a third of the density at FL350", () => {
  near(temperatureK(0), 288.15, 1e-9);
  near(temperatureK(12_000), 216.65, 1e-9);
  near(densityRatio(0), 1, 1e-9);
  near(densityRatio(10_668), 0.31, 0.01);
  near(speedOfSound(0), 340.3, 0.1);
  near(speedOfSound(10_668), 296.5, 0.5);
  // 250 kt indicated at FL350 is about 430 kt true.
  near(trueFromIndicated(128.6, 10_668), 230, 3);
  near(indicatedFromTrue(trueFromIndicated(150, 7300), 7300), 150, 1e-9);
  near(machOf(speedOfSound(5000) * 0.8, 5000), 0.8, 1e-9);
});

/* ---- physics ---- */

const FL350 = 10_668;
const fly = (state: AircraftState, seconds: number, input: ControlInput = NO_INPUT, env: Environment = STILL_AIR) => {
  let flown = state;
  for (let t = 0; t < seconds; t += 0.05) flown = step(flown, input, 0.05, env);
  return flown;
};
const held = (state: AircraftState, throttle: number) => ({ ...state, throttle, spool: throttle });
const cruise = levelFlight(5, 45, FL350, 90, 0.78 * speedOfSound(FL350));

test("cruise at Mach 0.78 at FL350 takes about three quarters of the thrust there is, and all of it stays short of Mach 0.85", () => {
  assert.ok(cruise.throttle > 0.65 && cruise.throttle < 0.85, `trim ${cruise.throttle}`);
  const steady = fly(cruise, 300);
  near(machOf(steady.tas, steady.altitude), 0.78, 0.005);
  near(steady.altitude, FL350, 10);
  const flat = fly(held(cruise, 1), 900, NO_INPUT, { ...STILL_AIR, autopilot: FL350 });
  const mach = machOf(flat.tas, flat.altitude);
  assert.ok(mach > 0.8 && mach < 0.85, `full thrust tops out at Mach ${mach}`);
  near(flat.altitude, FL350, 30);
});

test("trimmed, nothing drifts: the start holds its height, speed and heading", () => {
  const start = levelFlight(3, 43, 7300, 72, 220);
  assert.ok(start.throttle > 0.5 && start.throttle < 0.85, `trim ${start.throttle}`);
  near(trimThrottle(7300, 220), start.throttle, 1e-12);
  const later = fly(start, 20);
  near(later.altitude, 7300, 5);
  near(later.tas, 220, 0.5);
  near(later.heading, 72, 0.01);
});

test("at idle the flight path is held while the speed bleeds off; short of the stall the nose is let down, and it never stalls", () => {
  let state = held(levelFlight(3, 43, 3000, 0, 130), 0);
  const level = fly(state, 40);
  near(level.altitude, 3000, 5);
  assert.ok(level.tas < 115, `slowed to ${level.tas}`);
  assert.ok(level.pitch > state.pitch + 2, "the nose came up to hold the path");
  let slowest = Infinity;
  for (let t = 0; t < 240; t += 0.05) {
    // The lever is held back, as a hand on it does: the engines are not let go to full thrust for the angle of attack.
    state = step(state, { ...NO_INPUT, throttle: -1 }, 0.05);
    assert.ok(!state.stalled, `stalled at ${t} s`);
    slowest = Math.min(slowest, indicatedFromTrue(state.tas, state.altitude));
  }
  const clean = speedsFor(0);
  assert.ok(slowest > clean.stall, `as slow as ${slowest} m/s, the stall at ${clean.stall}`);
  assert.ok(state.altitude < 2900, "and then it comes down");
});

test("a wing taken past its stall loses lift, drops the nose, and flies again", () => {
  const slow = levelFlight(3, 43, 3000, 0, 80);
  let state = { ...slow, pitch: 24, alpha: 24 };
  state = step(state, NO_INPUT, 0.05);
  assert.ok(state.stalled);
  assert.ok(state.loadFactor < 1.1, `still carrying ${state.loadFactor} g`);
  let recovered = false;
  for (let t = 0; t < 60 && !recovered; t += 0.05) {
    state = step(state, NO_INPUT, 0.05);
    recovered = !state.stalled;
  }
  assert.ok(recovered, "it flies again");
  assert.ok(state.pitch < 16, `the nose came down to ${state.pitch}`);
});

test("slow and pulled back, the engines go to full thrust on their own, until the lever is moved", () => {
  let state = held(levelFlight(3, 43, 3000, 0, 105), 0.2);
  state = fly(state, 6, { ...NO_INPUT, pitch: 1 });
  assert.ok(state.alphaFloor);
  assert.equal(state.throttle, 1);
  assert.ok(!state.stalled);
  // Let go, the wing comes back from the edge, and the lever has its say again.
  state = fly(state, 4, { ...NO_INPUT, throttle: -1 });
  assert.ok(!state.alphaFloor);
  assert.ok(state.throttle < 0.5, `throttle at ${state.throttle}`);
});

test("let go, the flight path holds; a level turn at 30 degrees stays level and turns 1.5 degrees a second", () => {
  // Rolled into the turn with the stick, and let go at 30 degrees.
  let entry = levelFlight(3, 43, 7300, 0, 220);
  while (entry.roll + entry.rollRate * 0.3 < 30) entry = step(entry, { ...NO_INPUT, roll: 1 }, 0.05);
  entry = fly(entry, 2);
  near(entry.roll, 30, 1.5);
  const turning = fly(entry, 20);
  near(turning.roll, entry.roll, 0.05);
  near(turning.altitude, 7300, 15);
  near(turning.loadFactor, 1 / Math.cos((turning.roll * Math.PI) / 180), 0.02);
  // The turn a bank makes at 220 m/s: 1.475 degrees a second at 30.
  near(wrap180(turning.heading - entry.heading), (20 * 1.475 * Math.tan((turning.roll * Math.PI) / 180)) / Math.tan(Math.PI / 6), 1);
  near(turning.slip, 0, 0.05);

  // A pull is a load factor, and the nose follows the path up; let go, the path stays where it was left.
  const pulled = fly(levelFlight(3, 43, 7300, 0, 220), 3, { ...NO_INPUT, pitch: 1 });
  assert.ok(pulled.loadFactor > 1.6 && pulled.loadFactor <= 2.5, `pulled ${pulled.loadFactor} g`);
  assert.ok(pulled.flightPath > 4);
  const after = fly(pulled, 5);
  near(after.loadFactor, Math.cos((after.flightPath * Math.PI) / 180), 0.05);
  near(fly(after, 5).flightPath, after.flightPath, 0.3);
});

test("nothing stops the roll: held, the stick takes it through knife edge and onto its back and round, and let go it stays where it is", () => {
  const start = levelFlight(3, 43, 7300, 0, 220);
  // The bank as it goes, unwound: a roll held for twenty seconds goes all the way round and on.
  let state = start;
  let round = 0;
  for (let t = 0; t < 20; t += 0.05) {
    const next = step(state, { ...NO_INPUT, roll: 1 }, 0.05);
    round += wrap180(next.roll - state.roll);
    assert.ok(Number.isFinite(next.pitch + next.roll + next.heading + next.tas + next.alpha + next.loadFactor), `at ${t} s`);
    assert.ok(next.roll > -180 - 1e-9 && next.roll <= 180 + 1e-9, `roll ${next.roll}`);
    state = next;
  }
  assert.ok(round > 400, `rolled ${round} degrees`);
  near(state.rollRate, ROLL_RATE, 0.5);
  // Steeper than any turn and let go, it is not rolled back.
  const steep = fly(start, 3.5, { ...NO_INPUT, roll: 1 });
  assert.ok(steep.roll > 70 && steep.roll < 90, `banked ${steep.roll}`);
  const later = fly(steep, 3);
  assert.ok(later.roll > steep.roll - 1, `rolled back to ${later.roll}`);
  near(fly(start, 3.5, { ...NO_INPUT, roll: -1 }).roll, -steep.roll, 1e-6);
});

test("at knife edge the wing holds nothing up, and on its back the lift points at the ground: the nose falls", () => {
  const start = levelFlight(3, 43, 7300, 0, 220);
  const edge = fly({ ...start, roll: 90 }, 4);
  assert.ok(edge.flightPath < -8, `path at ${edge.flightPath}`);
  assert.ok(edge.heading > 5 && edge.heading < 90, `it turns the way it leans: ${edge.heading}`);
  const inverted = fly({ ...start, roll: 180 }, 4);
  assert.ok(inverted.flightPath < edge.flightPath - 5, `path at ${inverted.flightPath}`);
  assert.ok(inverted.loadFactor > 0.5, "it still pulls towards its own roof");
  assert.ok(Math.abs(inverted.roll) > 150, `still on its back: ${inverted.roll}`);
  // And rolled the right way up again it flies out of it.
  let state = inverted;
  for (let t = 0; t < 40; t += 0.05) state = step(state, { ...NO_INPUT, roll: Math.abs(state.roll) > 3 ? -Math.sign(state.roll) : 0, pitch: 0.6 }, 0.05);
  assert.ok(state.flightPath > -2 && Math.abs(state.roll) < 10, `path ${state.flightPath}, roll ${state.roll}`);
});

test("the rudder slips the nose off the path, drags, and rolls and turns the aircraft with it; let go, the nose comes back", () => {
  const slow = levelFlight(3, 43, 1500, 0, 90, { flaps: 2 });
  const env: Environment = { ...STILL_AIR, flapLever: 2 };
  const kicked = fly(slow, 2, { ...NO_INPUT, yaw: 1 }, env);
  assert.ok(kicked.slip > 6 && kicked.slip < 13, `slipped ${kicked.slip}`);
  assert.ok(wrap180(kicked.heading) > 6, `nose at ${kicked.heading}`);
  assert.ok(kicked.roll > 2, `rolled ${kicked.roll}`);
  assert.ok(kicked.tas < fly(slow, 2, NO_INPUT, env).tas - 0.1, "a slip drags");
  near(fly(slow, 2, { ...NO_INPUT, yaw: -1 }, env).slip, -kicked.slip, 1e-6);
  const held = fly(slow, 10, { ...NO_INPUT, yaw: 1 }, env);
  assert.ok(wrap180(held.track) > 10, `turned to ${held.track}`);
  near(fly(kicked, 6, NO_INPUT, env).slip, 0, 0.3);
  // Fast, the air holds the rudder back: less slip for the same pedal.
  const fast = fly(levelFlight(3, 43, 7300, 0, 220), 2, { ...NO_INPUT, yaw: 1 });
  assert.ok(fast.slip > 2 && fast.slip < kicked.slip * 0.7, `slipped ${fast.slip}`);
});

test("the pitch stops at its limits", () => {
  const start = levelFlight(3, 43, 7300, 0, 220);
  const up = fly(start, 20, { ...NO_INPUT, pitch: 1 });
  assert.ok(up.pitch <= PITCH_UP_LIMIT + 1, `pitched ${up.pitch}`);
  const down = fly(start, 12, { ...NO_INPUT, pitch: -1 });
  assert.ok(down.pitch >= PITCH_DOWN_LIMIT - 1, `pitched ${down.pitch}`);
  assert.ok(down.verticalSpeed < -30);
});

test("the throttle moves with W and S", () => {
  const start = levelFlight(3, 43, 7300, 90, 220);
  near(fly(held(start, 0.2), 2, { ...NO_INPUT, throttle: 1 }).throttle, 0.9, 0.01);
  assert.equal(fly(start, 4, { ...NO_INPUT, throttle: -1 }).throttle, 0);
});

test("the speed brake slows the aircraft, and a gust rocks it", () => {
  const start = levelFlight(3, 43, 7300, 0, 220);
  assert.ok(fly(start, 10, { ...NO_INPUT, brake: true }).tas < fly(start, 10).tas - 5);
  const rocked = fly(start, 1, NO_INPUT, { ...STILL_AIR, gust: { roll: 5, pitch: 0, vertical: -4 } });
  assert.ok(rocked.roll > 2);
  assert.ok(rocked.altitude < 7300 - 2);
});

/* ---- ice ---- */

const iced = (ice: number): Environment => ({ ...STILL_AIR, ice });

test("with no ice on it the aircraft is as it was; the more there is, the more it drags, the less it rolls and the less its engines give", () => {
  const start = levelFlight(3, 43, 3000, 0, 150);
  assert.deepEqual(fly(start, 5, { ...NO_INPUT, roll: 0.5, pitch: 0.3 }, iced(0)), fly(start, 5, { ...NO_INPUT, roll: 0.5, pitch: 0.3 }));
  const amounts = [0, 0.25, 0.5, 0.75, 1];
  const coasting = amounts.map((ice) => fly(start, 30, NO_INPUT, iced(ice)).tas);
  const pushed = amounts.map((ice) => fly(held(start, 1), 60, NO_INPUT, { ...iced(ice), autopilot: 3000 }).tas);
  const rolling = amounts.map((ice) => fly(start, 2, { ...NO_INPUT, roll: 1 }, iced(ice)).rollRate);
  for (let i = 1; i < amounts.length; i++) {
    assert.ok(coasting[i] < coasting[i - 1] && pushed[i] < pushed[i - 1] && rolling[i] < rolling[i - 1], `at ${amounts[i]}`);
  }
  assert.ok(coasting[4] < coasting[0] - 15, `slowed to ${coasting[4]} from ${coasting[0]}`);
  near(rolling[4], ROLL_RATE / 2, 0.5);
  // The last of the ice is what the engines choke on: full thrust is short by far more than the drag alone costs.
  assert.ok(pushed[3] - pushed[4] > 1.6 * (pushed[1] - pushed[2]), `full thrust holds ${pushed}`);
  assert.ok(pushed[4] < pushed[0] - 45);
});

test("an iced wing stalls well short of where the protections think it does, and drops on one side as it goes", () => {
  const slowing = (ice: number) => {
    let state = held(levelFlight(3, 43, 3000, 0, 130), 0);
    let seconds = 0;
    for (; seconds < 240 && !state.stalled; seconds += 0.05) state = step(state, { ...NO_INPUT, throttle: -1 }, 0.05, iced(ice));
    return { state, seconds, ias: indicatedFromTrue(state.tas, state.altitude) };
  };
  // A little ice, and what keeps the wing short of the stall still does.
  assert.ok(!slowing(0.2).state.stalled);
  const full = slowing(1);
  assert.ok(full.state.stalled, "it stalls");
  assert.ok(!full.state.alphaFloor, "and the engines were not sent to full thrust for it");
  assert.ok(full.ias > speedsFor(0).stall * 1.18, `stalled at ${full.ias} m/s, clean it is ${speedsFor(0).stall}`);
  assert.ok(Math.abs(full.state.roll) > 15 || Math.abs(fly(full.state, 4, NO_INPUT, iced(1)).roll) > 30, "a wing has dropped");
  // Unloaded and flown faster, the same aircraft flies: with half its roll, but it flies.
  const fast = fly(levelFlight(3, 43, 3000, 0, 170), 30, NO_INPUT, iced(1));
  assert.ok(!fast.stalled && Math.abs(fast.roll) < 1, `roll ${fast.roll}`);
  near(fast.altitude, 3000, 30);
});

test("the ground coming up warns ahead of time, and not over flat ground well below", () => {
  const descending = { ...levelFlight(3, 43, 1500, 0, 150), verticalSpeed: -40, flightPath: -15 };
  assert.ok(terrainAhead(descending, () => 900));
  assert.ok(!terrainAhead(levelFlight(3, 43, 1500, 0, 150), () => 200));
  // A ridge 10 s ahead, and not under the aircraft yet.
  const ridgeAt = ahead(levelFlight(3, 43, 2000, 0, 150), 10);
  assert.ok(terrainAhead(levelFlight(3, 43, 2000, 0, 150), (lon, lat) => (Math.abs(lat - ridgeAt.lat) < 0.01 ? 1950 : 0)));
  assert.ok(!terrainAhead(levelFlight(3, 43, 2000, 0, 150), () => null));
});

/* ---- flaps, spoilers, the ground ---- */

test("each step of the flaps lets the wing fly slower, and costs drag; they take their time to travel", () => {
  const stalls = [0, 1, 2, 3, 4].map((flaps) => speedsFor(flaps).stall);
  for (let flaps = 1; flaps < stalls.length; flaps++) assert.ok(stalls[flaps] < stalls[flaps - 1]);
  // About 144 kt clean and 105 kt with everything out, at this weight.
  near(stalls[0], 74, 2);
  near(stalls[4], 54, 2);
  near(speedsFor(4).lowest, stalls[4] * 1.23, 1e-9);
  assert.ok(speedsFor(4).limit < speedsFor(1).limit && speedsFor(1).limit < speedsFor(0).limit);
  assert.ok(speedsFor(0, 0, 1).limit < speedsFor(0).limit, "the gear has a limit of its own");

  const start = levelFlight(3, 43, 1500, 0, 95);
  const out = fly(start, 8, NO_INPUT, { ...STILL_AIR, flapLever: 2 });
  near(out.flaps, 8 / FLAP_NOTCH_S, 0.02);
  near(fly(out, 10, NO_INPUT, { ...STILL_AIR, flapLever: 2 }).flaps, 2, 1e-9);
  const dirty = fly(start, 30, NO_INPUT, { ...STILL_AIR, flapLever: 4 });
  assert.ok(dirty.tas < fly(start, 30).tas - 8, "the flaps slow it");
  near(dirty.altitude, 1500, 15);
});

test("the speed brake stands the spoilers half up: more drag, and a faster way down; not with the flaps all the way out", () => {
  const start = held(levelFlight(3, 43, 6000, 0, 200), 0);
  const braked = fly(start, 20, NO_INPUT, { ...STILL_AIR, speedbrake: true });
  near(braked.spoilers, SPEEDBRAKE, 1e-9);
  assert.ok(braked.tas < fly(start, 20).tas - 6, `${braked.tas} against ${fly(start, 20).tas}`);
  near(fly(start, 5, { ...NO_INPUT, brake: true }).spoilers, SPEEDBRAKE, 1e-9);
  const approach = levelFlight(3, 43, 600, 0, 70, { flaps: 4, gear: 1, path: -3 });
  assert.equal(fly(approach, 5, NO_INPUT, { ...STILL_AIR, gear: 1, flapLever: 4, speedbrake: true }).spoilers, 0);
});

const FIELD: Environment = { ...STILL_AIR, gear: 1, flapLever: 4, ground: 100, slope: 0 };
/** Down a three degree approach from 150 m up, flared from ten metres, engines to idle: what touches down. */
function land(env: Environment = FIELD, flare = 0.5): AircraftState {
  let state = levelFlight(3, 43, 250, 0, 71, { flaps: 4, gear: 1, path: -3 });
  for (let t = 0; t < 120 && !state.onGround; t += 0.05) {
    const low = state.altitude - 100 < 10;
    state = step(state, { ...NO_INPUT, pitch: low ? flare : 0, throttle: low ? -1 : 0 }, 0.05, env);
  }
  return state;
}

test("a trimmed approach comes down its three degrees; flared, it lands on its wheels, and the landing is kept as it was", () => {
  const approach = levelFlight(3, 43, 600, 0, 71, { flaps: 4, gear: 1, path: -3 });
  assert.ok(approach.pitch > 0 && approach.pitch < 5, `nose at ${approach.pitch}`);
  const later = fly(approach, 30, NO_INPUT, { ...FIELD, ground: 0 });
  near(later.flightPath, -3, 0.2);
  near(later.tas, 71, 1.5);

  const down = land();
  assert.ok(down.onGround);
  assert.equal(down.crash, null);
  assert.equal(down.altitude, 100);
  assert.ok(down.touchdown !== null && down.touchdown.sink < LANDING_LIMITS.firm, `came down at ${down.touchdown?.sink} m/s`);
  assert.ok(down.touchdown!.sink < land(FIELD, 0).touchdown!.sink, "a flare softens it");
});

test("on the ground the spoilers stand up and the brakes come on; reversers and held brakes shorten the roll", () => {
  const roll = (input: ControlInput) => {
    let state = land();
    let metres = 0;
    let spoilers = 0;
    for (let t = 0; t < 120 && state.tas > 0; t += 0.05) {
      state = step(state, input, 0.05, FIELD);
      metres += state.tas * 0.05;
      spoilers = Math.max(spoilers, state.spoilers);
    }
    return { state, metres, spoilers };
  };
  const plain = roll(NO_INPUT);
  assert.equal(plain.state.tas, 0);
  assert.equal(plain.spoilers, 1);
  assert.equal(plain.state.pitch, 0);
  // About three metres a second each second from 140 kt: under a kilometre.
  assert.ok(plain.metres > 600 && plain.metres < 1100, `rolled ${plain.metres} m`);
  assert.ok(roll({ ...NO_INPUT, brake: true }).metres < plain.metres - 100);
  // The brakes that come on by themselves hold their rate: behind them the reversers save the brakes, not the roll.
  near(roll({ ...NO_INPUT, throttle: -1 }).metres, plain.metres, 60);
  // Standing, it stays.
  near(fly(plain.state, 20, NO_INPUT, FIELD).tas, 0, 1e-9);
});

test("what is not a landing ends the flight, and says why", () => {
  assert.equal(land({ ...FIELD, gear: 0 }).crash, "gear");
  assert.equal(land({ ...FIELD, slope: 0.2 }).crash, "terrain");
  const dive = fly(levelFlight(3, 43, 300, 0, 71, { flaps: 4, gear: 1, path: -9 }), 60, NO_INPUT, { ...FIELD, autopilot: null });
  assert.equal(dive.crash, "hard");
  const banked = { ...levelFlight(3, 43, 101, 0, 71, { flaps: 4, gear: 1, path: -1 }), roll: 14 };
  assert.equal(fly(banked, 5, NO_INPUT, FIELD).crash, "attitude");
  const fast = levelFlight(3, 43, 101, 0, 125, { gear: 1, path: -1 });
  assert.equal(fly(fast, 5, NO_INPUT, { ...FIELD, flapLever: 0 }).crash, "fast");
});

test("a wreck slides to a stop on the way it was going, whatever the controls ask, and stays there", () => {
  const wreck = land({ ...FIELD, gear: 0 });
  assert.ok(wreck.tas > 50, `sliding at ${wreck.tas}`);
  const asked = { ...NO_INPUT, throttle: 1, pitch: 1, roll: 1, yaw: 1 };
  const sliding = fly(wreck, 2, asked, FIELD);
  assert.equal(sliding.crash, "gear");
  assert.ok(sliding.onGround && sliding.tas < wreck.tas - 15 && sliding.tas > 0, `at ${sliding.tas}`);
  assert.ok(distanceM(wreck.lon, wreck.lat, sliding.lon, sliding.lat) > 60);
  assert.equal(sliding.throttle, 0);
  const stopped = fly(wreck, 20, asked, FIELD);
  assert.equal(stopped.tas, 0);
  near(stopped.pitch, 0, 0.01);
  assert.equal(stopped.spool, 0);
  assert.equal(step(stopped, asked, 0.05, FIELD), stopped);
  // Flown into the ground, it stops where it hits; a wing low, it swings round on it.
  const dived = fly({ ...levelFlight(3, 43, 400, 0, 150, { path: -40 }) }, 10, NO_INPUT, FIELD);
  assert.equal(dived.crash, "hard");
  assert.equal(dived.tas, 0);
  const low = fly({ ...levelFlight(3, 43, 101, 0, 71, { flaps: 4, gear: 1, path: -1 }), roll: 14 }, 8, NO_INPUT, FIELD);
  assert.ok(wrap180(low.heading) > 10, `swung to ${low.heading}`);
});

test("standing on a slope it sits as the ground does, and rotates from there", () => {
  const env: Environment = { ...FIELD, flapLever: 1, tilt: { pitch: 3, roll: -4 } };
  const standing = fly(parked(3, 43, 100, 90), 5, NO_INPUT, env);
  near(standing.pitch, 3, 1e-3);
  near(standing.roll, -4, 1e-3);
  assert.equal(standing.alpha, 0);
  // Rotated, the nose comes up off the slope, by no more than the tail allows.
  let state = standing;
  for (let t = 0; t < 60 && state.onGround; t += 0.05) {
    state = step(state, { ...NO_INPUT, throttle: 1, pitch: state.tas > 72 ? 0.8 : 0 }, 0.05, env);
    assert.ok(state.pitch - 3 <= TAIL_STRIKE + 1e-9 && state.pitch >= 3 - 1e-9, `pitch ${state.pitch}`);
  }
  assert.ok(!state.onGround, "it left the ground");
  // A wreck comes to rest on it too.
  const wrecked = fly({ ...standing, crash: "terrain", tas: 0 }, 20, NO_INPUT, env);
  near(wrecked.pitch, 3, 0.01);
});

test("from standing: full thrust, the nose will not come up before there is air over the tail, and rotated it flies", () => {
  const env: Environment = { ...FIELD, flapLever: 1 };
  let state = parked(3, 43, 100, 90);
  near(fly(state, 20, NO_INPUT, env).tas, 0, 1e-9);
  let early = state;
  for (let t = 0; t < 12; t += 0.05) early = step(early, { ...NO_INPUT, throttle: 1, pitch: 1 }, 0.05, env);
  assert.ok(early.onGround && early.pitch < 0.5, `nose at ${early.pitch} at ${early.tas} m/s`);
  let seconds = 0;
  let metres = 0;
  for (; seconds < 60 && state.onGround; seconds += 0.05) {
    state = step(state, { ...NO_INPUT, throttle: 1, pitch: state.tas > 72 ? 0.8 : 0 }, 0.05, env);
    metres += state.tas * 0.05;
    assert.ok(state.pitch <= TAIL_STRIKE + 1e-9);
  }
  assert.ok(!state.onGround, "it left the ground");
  assert.ok(seconds > 20 && seconds < 40, `after ${seconds} s`);
  assert.ok(metres > 700 && metres < 1600, `after ${metres} m`);
  near(state.heading, 90, 0.01);
  const climbing = fly(state, 15, { ...NO_INPUT, throttle: 1 }, env);
  assert.ok(!climbing.onGround && climbing.altitude > 150, `at ${climbing.altitude} m`);
  assert.equal(climbing.crash, null);
});

test("on the ground the rudder steers the nose wheel, and a landed aircraft at idle does not bounce back into the air", () => {
  const taxi = fly({ ...parked(3, 43, 100, 0), tas: 8 }, 3, { ...NO_INPUT, yaw: 1, throttle: 1 }, FIELD);
  assert.ok(taxi.heading > 15 && taxi.heading < 60, `turned to ${taxi.heading}`);
  assert.equal(taxi.roll, 0);
  const down = land();
  const held = fly(down, 2, { ...NO_INPUT, pitch: 1 }, FIELD);
  assert.ok(held.onGround);
});

/* ---- spawn ---- */

const tile = (lon: number, lat: number, peakDbz: number, patch: Partial<StormTile> = {}): StormTile => ({
  lon, lat, peakDbz, areaKm2: 400, coarse: true, tile: [9, 0, 0], ...patch,
});

test("adjacent tiles are one system, far ones another; coarse tiles where there are any", () => {
  const tiles = [
    tile(4.0, 43.6, 55), tile(4.7, 43.6, 50), tile(4.7, 43.2, 45),
    tile(12, 52, 40),
    tile(4.1, 43.6, 60, { coarse: false, tile: [11, 0, 0] }),
  ];
  const systems = stormSystems(tiles);
  assert.equal(systems.length, 2);
  assert.equal(systems[0].tiles, 3);
  assert.equal(systems[0].peakDbz, 55);
  assert.ok(systems[0].radiusKm > 30);
  // Fine tiles only, they are grouped themselves.
  assert.equal(stormSystems([tile(4, 43, 50, { coarse: false, tile: [11, 0, 0] })]).length, 1);
});

test("of two equal systems, the one by the mountains wins, and nearness to where the reader looked counts", () => {
  const plain = stormSystems([tile(-1.0, 47.0, 55)])[0];
  const alpine = stormSystems([tile(10.5, 46.5, 55)])[0];
  assert.ok(reliefAt(10.5, 46.5) > reliefAt(-1, 47));
  assert.deepEqual(rankSystems([plain, alpine], 4.5, 46.8)[0], alpine);
  // Looked at from right over the plain one, it is the nearer that wins.
  const strong = stormSystems([tile(-1.0, 47.0, 58)])[0];
  assert.deepEqual(rankSystems([strong, alpine], -1.0, 47.0)[0], strong);
});

test("the approach starts short of the system, nose on it, with the sun behind where it can", () => {
  const tiles = [tile(4.0, 44.0, 55)];
  const approach = approachTo(stormSystems(tiles)[0], tiles);
  const km = distanceM(approach.lon, approach.lat, 4.0, 44.0) / 1000;
  assert.ok(km > START_KM && km < START_KM + 60, `starts ${km} km out`);
  near(wrap180(bearingDeg(approach.lon, approach.lat, 4.0, 44.0) - approach.heading), 0, 0.5);
  // Flying away from the sun, give or take one of the twelve bearings and the relief.
  assert.ok(Math.abs(wrap180(approach.heading - (SUN_BEARING + 180))) <= 60, `heading ${approach.heading}`);
  assert.equal(approach.altitude, START_ALTITUDE_M);
});

test("the approach starts short of the system's near edge, not of its far reach", () => {
  // A line of storms 300 km long, north to south: from the west, it is near.
  const line = Array.from({ length: 7 }, (_, i) => tile(4.0, 42.0 + i * 0.45, 55));
  const system = stormSystems(line)[0];
  assert.ok(system.radiusKm > 120);
  assert.ok(edgeKm(system, 270) < 50, `edge ${edgeKm(system, 270)}`);
  near(edgeKm(system, 0), system.radiusKm, 3);
  // From along the line, no further from its towers than a couple of minutes' flight.
  const along = approachTo({ ...system, extent: system.extent }, line);
  assert.ok(distanceM(along.lon, along.lat, system.lon, system.lat) <= MAX_START_KM * 1000 + 1);
});

test("a system is aimed at its towers, not the middle of its rain", () => {
  const tiles = [tile(4.0, 43.0, 62), ...Array.from({ length: 6 }, (_, i) => tile(5.0 + i * 0.7, 43.5, 32))];
  const system = stormSystems(tiles)[0];
  assert.ok(distanceM(system.lon, system.lat, 4.0, 43.0) < 5000, `aimed at ${system.lon}, ${system.lat}`);
});

test("the approach does not start inside another storm", () => {
  const target = tile(4.0, 44.0, 60);
  const lonely = approachTo(stormSystems([target])[0], [target]);
  // Another system right where the lonely approach would have started.
  const blocker = tile(lonely.lon, lonely.lat, 35, { tile: [11, 0, 0], coarse: false });
  const system = stormSystems([target])[0];
  const approach = approachTo(system, [target, blocker]);
  assert.ok(distanceM(approach.lon, approach.lat, blocker.lon, blocker.lat) > 15_000);
});

test("the start is raised over high ground, and with no weather it starts over where the reader looked", () => {
  near(startAltitude(7, 46, 90, () => 4800), 7800, 1e-9);
  assert.equal(startAltitude(7, 46, 90, () => null), START_ALTITUDE_M);
  const clear = chooseApproach([], { lon: 4.6, lat: 43.3, bearing: 20 }, null);
  assert.equal(clear.target, null);
  assert.equal(clear.heading, 20);
  near(distanceM(clear.lon, clear.lat, 4.6, 43.3), 30_000, 10);
  near(bearingDeg(clear.lon, clear.lat, 4.6, 43.3), 20, 0.5);
});

test("the next system comes round in turn, severest first, whatever is nearer the reader", () => {
  const tiles = [tile(4.0, 44.0, 45), tile(12, 52, 62), tile(20, 48, 55)];
  const look = { lon: 4, lat: 44, bearing: 0 };
  const first = chooseApproach(tiles, look, null).target!;
  assert.equal(first.peakDbz, 62);
  const second = chooseApproach(tiles, look, first).target!;
  assert.equal(second.peakDbz, 55);
  const third = chooseApproach(tiles, look, second).target!;
  assert.equal(third.peakDbz, 45);
  assert.deepEqual(chooseApproach(tiles, look, third).target, first);
  // A storm moved a little since: still the one flown, and the next after it.
  assert.equal(chooseApproach(tiles, look, { lon: first.lon + 0.3, lat: first.lat }).target!.peakDbz, 55);
  // One no longer on the radar: back to the severest.
  assert.equal(chooseApproach(tiles, look, { lon: -20, lat: 30 }).target!.peakDbz, 62);
});

/* ---- selection ---- */

test("held in flight: ahead and close first, then nearest, as far as the budget goes", () => {
  const lookout = { lon: 4, lat: 44, heading: 90, fovDeg: 90 };
  const at = (bearing: number, km: number, name: string) => {
    const [lon, lat] = destination(4, 44, bearing, km * 1000);
    return { lon, lat, name };
  };
  const volumes = [
    at(270, 50, "behind"), at(90, 200, "far ahead"), at(80, 100, "ahead"), at(180, 20, "close behind"), at(90, 400, "too far"),
  ];
  const held = flightWanted(volumes, lookout, 1000, () => 100).map(({ name }) => name);
  assert.deepEqual(held, ["close behind", "ahead", "far ahead", "behind"]);
  assert.deepEqual(flightWanted(volumes, lookout, 250, () => 100).map(({ name }) => name), ["close behind", "ahead"]);
});

test("drawn fine in flight: near tiles, nearest first, with hysteresis and within the budget", () => {
  const lookout = { lon: 4, lat: 44 };
  const place = (km: number, code: string): CoarsePlace => {
    const [lon, lat] = destination(4, 44, 0, km * 1000);
    return { code, lon, lat, coarseBytes: 10, fineBytes: 40 };
  };
  const places = [place(80, "border"), place(20, "near"), place(50, "middle"), place(150, "far")];
  assert.deepEqual([...flightFine(places, lookout, new Set(), 1000)].sort(), ["middle", "near"]);
  // Already fine, the one at 80 km stays fine until 90.
  assert.deepEqual([...flightFine(places, lookout, new Set(["border"]), 1000)].sort(), ["border", "middle", "near"]);
  // Room for one more fine tile's extra bytes: the nearest.
  assert.deepEqual([...flightFine(places, lookout, new Set(), 30)], ["near"]);
});

/* ---- weather ---- */

/** A 4 x 4 x 4 volume of 1 km voxels, every voxel `dbz` but one column of 55 at x 2, y 2: the one in its middle. */
function volume(lon: number, lat: number, dbz: number) {
  const header = {
    code: "T", reference_time: "", lon, lat, nx: 4, ny: 4, nz: 4, step_m: [1000, 1000, 1000] as [number, number, number],
    origin_m: [-2000, -2000, 0] as [number, number, number], dbz_floor: -32, dbz_scale: 2, sites: [], coverage: 1,
  };
  const voxels = new Uint8Array(4 * 4 * 4 * 2);
  for (let z = 0; z < 4; z += 1) {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const at = ((z * 4 + y) * 4 + x) * 2;
        voxels[at] = ((x === 2 && y === 2 ? 55 : dbz) + 32) * 2;
        voxels[at + 1] = 255;
      }
    }
  }
  return { header, voxels, extentM: [4000, 4000, 4000] as [number, number, number] };
}

test("the reflectivity at a point is the voxel's it stands in, null outside every volume", () => {
  const box = volume(4, 44, 20);
  near(reflectivityAt([box], 4, 44, 500)!, 55, 1e-9);
  // 1.5 km west and 1.5 km south of the middle: the corner voxel.
  const [lon, lat] = destination(...destination(4, 44, 270, 1500), 180, 1500);
  near(reflectivityAt([box], lon, lat, 3500)!, 20, 1e-9);
  assert.equal(reflectivityAt([box], 4, 44, 4500), null);
  assert.equal(reflectivityAt([box], 4.2, 44, 500), null);
  // Overlapping, the stronger.
  near(reflectivityAt([box, volume(4, 44, 40)], lon, lat, 500)!, 40, 1e-9);
});

test("turbulence, cloud and rain come in with the echo", () => {
  assert.equal(turbulenceOf(null), 0);
  assert.equal(turbulenceOf(10), 0);
  assert.equal(turbulenceOf(55), 1);
  assert.ok(turbulenceOf(35) > 0 && turbulenceOf(35) < 0.6);
  assert.equal(cloudOf(10), 0);
  assert.equal(cloudOf(40), 1);
  assert.equal(rainOf(25), 0);
  assert.equal(rainOf(50), 1);
  assert.deepEqual(gustAt(3, 0), { roll: 0, pitch: 0, vertical: 0 });
  assert.notDeepEqual(gustAt(3, 1), gustAt(4, 1));
  assert.deepEqual(gustAt(3, 1), gustAt(3, 1));
});

/* ---- controls ---- */

test("keys by their place on the keyboard: forward is nose down, A and D the rudder, W and S the throttle", () => {
  const input = controlInput(new Set(["ArrowUp", "ArrowRight", "KeyW", "KeyA", "ShiftLeft", "Space"]));
  assert.deepEqual(input, { pitch: -1, roll: 1, yaw: -1, throttle: 1, brake: true, warp: true });
  assert.deepEqual(controlInput(new Set(["Numpad5", "Numpad4", "KeyS"])), {
    pitch: 1, roll: -1, yaw: 0, throttle: -1, brake: false, warp: false,
  });
  // Both ways at once is neither.
  assert.equal(controlInput(new Set(["ArrowLeft", "ArrowRight"])).roll, 0);
});

test("the one-press keys, and which keys the flight keeps from the page", () => {
  assert.equal(actionOf("Escape"), "leave");
  assert.equal(actionOf("KeyL"), "autopilot");
  assert.equal(actionOf("Backspace"), "restart");
  assert.equal(actionOf("Digit7", "?"), "help");
  assert.equal(actionOf("KeyQ"), "silence");
  assert.equal(actionOf("KeyE"), null);
  assert.ok(isFlightKey("Space"));
  assert.ok(isFlightKey("ArrowDown"));
  assert.ok(!isFlightKey("KeyE"));
});

test("a gamepad flies with its left stick, triggers and bumpers, past a dead zone", () => {
  const buttons = Array.from({ length: 8 }, () => ({ value: 0, pressed: false }));
  buttons[7] = { value: 1, pressed: true };
  buttons[4] = { value: 1, pressed: true };
  const pad = gamepadInput({ axes: [0.05, 1], buttons });
  assert.deepEqual(pad, { pitch: 1, roll: 0, yaw: -1, throttle: 1, brake: false });
  assert.deepEqual(merged({ ...NO_INPUT, roll: 1 }, pad), { pitch: 1, roll: 1, yaw: -1, throttle: 1, brake: false });
});

/* ---- the storms' scissor ---- */

/** A camera at the origin looking down -z, 90 degrees across, as GL's perspective matrix has it. */
function perspective(near = 0.1, far = 1000): number[] {
  const f = 1;
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
/** A box's model matrix through the camera: the unit cube scaled by `size` and moved to `at`. */
function through(at: [number, number, number], size: [number, number, number] = [1, 1, 1]): number[] {
  const p = perspective();
  const model = [size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, ...at, 1];
  return Array.from({ length: 16 }, (_, i) => {
    const [c, r] = [Math.floor(i / 4), i % 4];
    return [0, 1, 2, 3].reduce((sum, k) => sum + p[k * 4 + r] * model[c * 4 + k], 0);
  });
}
const UNIT: Array<[number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

test("a box in front is scissored to where it projects, one behind not drawn, one around the camera everywhere", () => {
  const rect = screenRect(through([-0.5, -0.5, -10]), UNIT, 1000, 1000)!;
  assert.ok(rect[2] < 150 && rect[3] < 150, `rect ${rect}`);
  assert.equal(screenRect(through([-0.5, -0.5, 5]), UNIT, 1000, 1000), null);
  assert.deepEqual(screenRect(through([-2, -2, -2], [4, 4, 4]), UNIT, 1000, 1000), [0, 0, 1000, 1000]);
});

test("a box reaching behind the camera off to one side covers only its side of the screen", () => {
  // From x 2 to 3 and z -20 to +5: beside the camera, and past it.
  const rect = screenRect(through([2, -0.5, -20], [1, 1, 25]), UNIT, 1000, 1000)!;
  assert.ok(rect[0] > 500, `rect ${rect}`);
  assert.equal(rect[0] + rect[2], 1000);
});

/* ---- the eye ---- */

/** A point of the aircraft's frame as a camera sees it: right, up, and how far in front. */
function seen(modelView: number[], [x, y, z]: [number, number, number]): [number, number, number] {
  const at = (row: number) => modelView[row] * x + modelView[4 + row] * y + modelView[8 + row] * z + modelView[12 + row];
  return [at(0), at(1), -at(2)];
}

test("an attitude comes back out of the turn it makes", () => {
  for (const attitude of [{ heading: 59, pitch: 4, roll: -25 }, { heading: 301, pitch: -12, roll: 40 }]) {
    const back = attitudeOf(rotation(attitude));
    near(back.heading, attitude.heading, 1e-9);
    near(back.pitch, attitude.pitch, 1e-9);
    near(back.roll, attitude.roll, 1e-9);
  }
});

test("from the seat, looking ahead, the eye has the aircraft's own attitude and sees the nose in front of it", () => {
  const attitude = { heading: 120, pitch: 3, roll: 20 };
  const seat: [number, number, number] = [14, -0.5, -0.7];
  const eye = cockpitEye(attitude, { yaw: 0, pitch: 0 }, seat);
  near(eye.heading, 120, 1e-9);
  near(eye.pitch, 3, 1e-9);
  near(eye.roll, 20, 1e-9);
  // A point two metres ahead of the seat, half a metre to its right and a little below it.
  const [right, up, front] = seen(eye.modelView, [16, 0, -0.5]);
  near(right, 0.5, 1e-9);
  near(up, -0.2, 1e-9);
  near(front, 2, 1e-9);
  // The seat is forward of the aircraft's middle: north-east of it on this heading, and above.
  assert.ok(eye.north < 0 && eye.east > 0 && eye.up > 0);
});

test("a head turned right looks right of the nose, and sees what was ahead on its left", () => {
  const level = { heading: 0, pitch: 0, roll: 0 };
  const eye = cockpitEye(level, { yaw: 90, pitch: 0 }, [0, 0, 0]);
  near(eye.heading, 90, 1e-9);
  const [right, , front] = seen(eye.modelView, [10, 0, 0]);
  near(right, -10, 1e-9);
  near(front, 0, 1e-9);
  // In a right bank, the same head looks down along the wing.
  const banked = cockpitEye({ heading: 0, pitch: 0, roll: 30 }, { yaw: 90, pitch: 0 }, [0, 0, 0]);
  near(banked.pitch, -30, 1e-9);
});

test("from outside, the eye stands off the aircraft, level, with the aircraft in the middle of its view", () => {
  const eye = outsideEye({ heading: 40, pitch: 5, roll: 35 }, { yaw: 0, pitch: -10 }, 80);
  near(eye.roll, 0, 1e-9);
  near(eye.heading, 40, 1e-9);
  near(Math.hypot(eye.north, eye.east, eye.up), 80, 1e-9);
  // Behind it and above: south-west of an aircraft heading north-east.
  assert.ok(eye.north < 0 && eye.east < 0 && eye.up > 0);
  const [right, up, front] = seen(eye.modelView, [0, 0, 0]);
  near(right, 0, 1e-9);
  near(up, 0, 1e-9);
  near(front, 80, 1e-9);
});

test("the sun over the left wing of an aircraft heading north is on its left, wherever it stood in the world", () => {
  const [forward, right, down] = inAircraft({ heading: 0, pitch: 0, roll: 0 }, [0, -1, 0]);
  near(forward, 0, 1e-9);
  near(right, -1, 1e-9);
  near(down, 0, 1e-9);
  near(inAircraft({ heading: 270, pitch: 0, roll: 0 }, [0, -1, 0])[0], 1, 1e-9);
});

/* ---- the model's file ---- */

test("a model's file is read back as its chunks, and anything else refused", () => {
  const header = new TextEncoder().encode(JSON.stringify({
    title: "t", author: "a", licence: "l", source: "s",
    materials: [{ texture: null, colour: [1, 1, 1], opacity: 1 }],
    chunks: [{ material: 0, vertices: 3, indices: 3, offset: 0, min: [0, 0, 0], size: [1, 1, 1], uvMin: [0, 0], uvSize: [1, 1] }],
  }).padEnd(400, " "));
  const body = new Uint8Array(3 * VERTEX_BYTES + 8);
  new Uint16Array(body.buffer, 3 * VERTEX_BYTES, 3).set([0, 1, 2]);
  const file = new Uint8Array(8 + header.length + body.length);
  file.set([0x4d, 0x43, 0x4d, 0x31]);
  new DataView(file.buffer).setUint32(4, header.length, true);
  file.set(header, 8);
  file.set(body, 8 + header.length);
  const model = parseModel(file.buffer);
  assert.equal(model.chunks.length, 1);
  assert.equal(model.chunks[0].vertices.byteLength, 3 * VERTEX_BYTES);
  assert.deepEqual([...model.chunks[0].indices], [0, 1, 2]);
  assert.throws(() => parseModel(new Uint8Array(16).buffer));
  assert.throws(() => parseModel(file.buffer.slice(0, file.length - 8)));
});

/* ---- the plan and its briefing ---- */

const planTiles: StormTile[] = [
  { lon: 4.0, lat: 43.6, peakDbz: 62, areaKm2: 900, coarse: true, tile: [9, 261, 186] },
  { lon: 4.5, lat: 43.6, peakDbz: 55, areaKm2: 700, coarse: true, tile: [9, 262, 186] },
  { lon: 11.0, lat: 50.0, peakDbz: 41, areaKm2: 500, coarse: true, tile: [9, 271, 173] },
];

test("a plan starts as the approach the flight would choose, and reads back as one", () => {
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const approach = approachTo(systems[0], planTiles);
  const plan = planFrom(approach, "sky");
  assert.deepEqual(approachOf(plan), approach);
  assert.equal(plan.aimed, true);
  assert.equal(plan.view, "cockpit");
});

test("a start moved keeps its nose on the storm, until the reader turns it; handed back, it is on the storm again", () => {
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const plan = planFrom(approachTo(systems[0], planTiles), "sky");
  const moved = movedTo(plan, 2.0, 43.0);
  near(moved.heading, bearingDeg(2.0, 43.0, systems[0].lon, systems[0].lat), 1e-9);
  const turned = headed(moved, 400);
  assert.equal(turned.heading, 40);
  assert.equal(turned.aimed, false);
  assert.equal(movedTo(turned, 1.0, 43.0).heading, 40);
  const back = headed(movedTo(turned, 1.0, 43.0), null);
  near(back.heading, bearingDeg(1.0, 43.0, systems[0].lon, systems[0].lat), 1e-9);
});

test("another level keeps the Mach number, and both stay in what a flight starts at", () => {
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const plan = atMach(planFrom(approachTo(systems[0], planTiles), "sky"), 0.7);
  near(machOf(plan.tas, plan.altitude), 0.7, 1e-9);
  const high = levelled(plan, 11_000);
  near(machOf(high.tas, high.altitude), 0.7, 1e-9);
  assert.ok(high.tas < plan.tas);
  assert.equal(levelled(plan, 50_000).altitude, ALTITUDE_RANGE[1]);
  near(machOf(atMach(plan, 2).tas, plan.altitude), machRange(plan.altitude)[1], 1e-9);
  // A Mach number too slow for the level it is taken to is raised to the slowest that is not.
  const slowLow = atMach(levelled(plan, 1600), 0);
  const slowHigh = levelled(slowLow, ALTITUDE_RANGE[1]);
  near(machOf(slowHigh.tas, slowHigh.altitude), machRange(ALTITUDE_RANGE[1])[0], 1e-9);
});

test("every level and speed the plan allows is flown as it was set: no stall, no overspeed, the height held", () => {
  const KT = 1.943844;
  for (let altitude = ALTITUDE_RANGE[0]; altitude <= ALTITUDE_RANGE[1] + 1; altitude += (ALTITUDE_RANGE[1] - ALTITUDE_RANGE[0]) / 6) {
    for (const mach of machRange(altitude)) {
      const start = levelFlight(3, 43, altitude, 90, mach * speedOfSound(altitude));
      const ias = indicatedFromTrue(start.tas, altitude) * KT;
      assert.ok(ias >= 219.9 && ias <= 340.1 && mach <= 0.8 + 1e-9, `${Math.round(altitude)} m M${mach.toFixed(3)} ${Math.round(ias)} kt`);
      assert.ok(start.throttle < 0.97, `trim ${start.throttle} at ${Math.round(altitude)} m M${mach.toFixed(3)}`);
      const later = fly(start, 60);
      assert.ok(!later.stalled, `stalled at ${Math.round(altitude)} m M${mach.toFixed(3)}`);
      assert.ok(Math.abs(later.altitude - altitude) < 30, `${Math.round(later.altitude - altitude)} m off at ${Math.round(altitude)} m M${mach.toFixed(3)}`);
      assert.ok(Math.abs(later.tas - start.tas) < 3, `${(later.tas - start.tas).toFixed(1)} m/s off at ${Math.round(altitude)} m M${mach.toFixed(3)}`);
    }
  }
});

test("another storm is flown at from its own best side, at the level and speed already chosen", () => {
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const plan = levelled(planFrom(approachTo(systems[0], planTiles), "sky"), 9000);
  const other = retargeted(plan, systems[1], planTiles);
  assert.equal(other.target, systems[1]);
  assert.equal(other.altitude, plan.altitude);
  near(other.heading, bearingDeg(other.lon, other.lat, systems[1].lon, systems[1].lat), 1e-9);
});

test("a place and a level are written as a chart and a crew write them", () => {
  assert.equal(position(2.62, 43.02), "N43°01' E002°37'");
  assert.equal(position(-0.5, -12.25), "S12°15' W000°30'");
  assert.equal(flightLevel(7315.2), "FL240");
});

test("the briefing reads the plan back: the route, the weather at its end, the ground on the way", () => {
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const plan = movedTo(planFrom(approachTo(systems[0], planTiles), "sky"), 2.6, 43.0);
  const lines = briefing(plan, systems, Date.UTC(2026, 10, 19, 18, 15) / 1000);
  const line = (item: string) => lines.find((each) => each.item === item);
  assert.match(line("route")!.text, /^N43°00' E002°36' DCT CB .* TRK \d{3}° · \d+ NM$/);
  assert.match(line("level")!.text, /^FL240 · \d+ KT IAS · M\.\d\d · TAS \d+ KT$/);
  assert.match(line("weather")!.text, /SEV TS .* MAX 62 DBZ/);
  assert.equal(line("weather")!.caution, true);
  assert.match(line("time")!.text, /MIN TO FIRST ECHO · \d+ MIN TO CORE · \d+ MIN AT ×4/);
  // The other system is in Franconia, a long way off: not within 150 NM.
  assert.equal(line("others"), undefined);
  assert.match(line("radar")!.text, /^SCAN 1815Z/);
  assert.equal(lines[lines.length - 1].text, "NOT FOR NAVIGATION");
  // Turned away from the storm, the route says by how much, and minds it past a right angle's half.
  const away = briefing(headed(plan, plan.heading + 90), systems, null);
  assert.match(away[0].text, /HDG \d{3}° \(90° R OF TRK\)/);
  assert.equal(away[0].caution, true);
});

test("high ground on the way is named, and a level under it minded", () => {
  const alps = { lon: 9.0, lat: 45.0, heading: 0 };
  assert.deepEqual(highGround(alps, 200), { name: "Alps", summit: 4810 });
  assert.equal(highGround({ lon: 10.0, lat: 53.0, heading: 0 }, 100), null);
  const systems = rankSystems(stormSystems(planTiles), 4.2, 43.4);
  const low = { ...levelled(planFrom(approachTo(systems[0], planTiles), "sky"), ALTITUDE_RANGE[0]), ...alps, target: null };
  const terrain = briefing(low, systems, null).find((each) => each.item === "terrain")!;
  assert.match(terrain.text, /ALPS ON TRACK · HIGHEST GROUND 15800 FT · FL050 IS BELOW SAFE LEVEL/);
  assert.equal(terrain.caution, true);
});

test("with no weather the briefing says so, and what a storm's echo means is graded by its strength", () => {
  const plan = planFrom({ lon: 10, lat: 53, heading: 90, altitude: 7300, target: null }, "sky");
  const lines = briefing(plan, [], null);
  assert.match(lines[0].text, /NO DESTINATION/);
  assert.match(lines.find((each) => each.item === "weather")!.text, /NIL SIG WX/);
  assert.match(lines.find((each) => each.item === "inside")!.text, /TURB RISING/);
  assert.equal(weatherOf(60).severe, true);
  assert.equal(weatherOf(38).severe, false);
  assert.match(weatherOf(20).text, /LGT/);
});

/* ---- the storms marked in the view ---- */

test("the cores of the listed storms are their strongest tiles, one to a storm", () => {
  const fine = (lon: number, lat: number, peakDbz: number): StormTile => ({ lon, lat, peakDbz, areaKm2: 100, coarse: false, tile: [11, 0, 0] });
  const cores = coresOf([
    fine(4.0, 43.5, 61), fine(4.1, 43.5, 58), fine(4.0, 43.6, 55), fine(5.2, 43.5, 47), fine(6.5, 43.5, 30),
    { lon: 4.0, lat: 43.5, peakDbz: 63, areaKm2: 900, coarse: true, tile: [9, 0, 0] },
  ]);
  assert.deepEqual(cores.map((core) => core.peakDbz), [61, 47]);
  // A list of coarse tiles alone still has cores.
  assert.equal(coresOf([{ lon: 4.0, lat: 43.5, peakDbz: 63, areaKm2: 900, coarse: true, tile: [9, 0, 0] }]).length, 1);
});

test("the marks for a view are tracked cells before cores of the same storm, those ahead before those behind", () => {
  const mark = (lon: number, lat: number, peakDbz: number, top: number | null = null) => ({ lon, lat, peakDbz, top, heading: null, speed: null, hail: false });
  const cells = [mark(4.0, 44.0, 55, 11_000), mark(4.0, 43.6, 30)];
  const cores = [mark(4.05, 44.02, 60), mark(4.0, 42.5, 50), mark(4.0, 46.9, 50)];
  // From 43.0N heading north: the tracked cell ahead, then the core behind; the core on the cell is the cell, the far one out of reach.
  const marks = marksNear(cells, cores, 4.0, 43.0, 0);
  assert.deepEqual(marks.map(({ lat, peakDbz }) => [lat, peakDbz]), [[44.0, 55], [42.5, 50]]);
  assert.equal(markAltitude(marks[0]), 12_500);
  assert.ok(markAltitude(mark(0, 0, 62)) > markAltitude(mark(0, 0, 45)));
  assert.ok(markAltitude(mark(0, 0, 90)) <= 15_000);
});

test("a point ahead of a level eye is in the middle of its picture, one to its right right of it, one below below", () => {
  const level = { heading: 90, pitch: 0, roll: 0 };
  const middle = seenFrom(level, [0, 1000, 0], 60, 1.5)!;
  near(middle.x, 0.5, 1e-9);
  near(middle.y, 0.5, 1e-9);
  near(middle.ahead, 1000, 1e-9);
  // South is to the right of an eye looking east.
  assert.ok(seenFrom(level, [-200, 1000, 0], 60, 1.5)!.x > 0.5);
  assert.ok(seenFrom(level, [0, 1000, 200], 60, 1.5)!.y > 0.5);
  // The edge of a 60 degree lens is 30 degrees up.
  near(seenFrom(level, [0, 1000, -1000 * Math.tan(Math.PI / 6)], 60, 1.5)!.y, 0, 1e-9);
  assert.equal(seenFrom(level, [0, -1000, 0], 60, 1.5), null);
});

test("a place north on the flat map is further than its true distance, as the map draws it", () => {
  const [north, east] = flatOffset(4, 43, 4, 44);
  assert.ok(north > 111_195 && north < 111_195 * 1.02);
  near(east, 0, 1e-6);
  near(flatOffset(4, 43, 5, 43)[1], 111_195 * Math.cos((43 * Math.PI) / 180), 30);
});

/* ---- where the clouds begin ---- */

test("air lifts 125 m for every degree between its temperature and its dew point before it condenses", () => {
  near(condensationLevel({ elevation: 300, temperature: 20, dewPoint: 12 }), 1300, 1e-9);
  near(condensationLevel({ elevation: 300, temperature: 5, dewPoint: 9 }), 300, 1e-9);
});

test("the cloud base is the middle one of the stations in reach that are not in the rain", () => {
  const station = (lon: number, lat: number, spread: number, elevation = 400) => ({ lon, lat, elevation, temperature: 20, dewPoint: 20 - spread });
  const stations = [
    station(10.0, 50.0, 8), station(10.2, 50.1, 10), station(9.8, 49.9, 12), station(10.1, 50.2, 30),
    // In the rain, and a country away: neither counts.
    station(10.0, 50.05, 0.3), station(20.0, 50.0, 2),
  ];
  const base = cloudBase(stations, 10, 50)!;
  assert.equal(base.stations, 4);
  near(base.km, (400 + 11 * 125) / 1000, 1e-9);
  assert.equal(cloudBase(stations.slice(0, 2), 10, 50), null);
  // Never under what is believed, nor over it.
  assert.equal(cloudBase([station(10, 50, 60), station(10, 50, 60), station(10, 50, 60)], 10, 50)!.km, BASE_RANGE_KM[1]);
});

test("the briefing says where the clouds begin, and whether stations said so", () => {
  const plan = planFrom({ lon: 10, lat: 50, heading: 90, altitude: 7300, target: null }, "sky");
  const line = (lines: ReturnType<typeof briefing>) => lines.find((each) => each.item === "base")!.text;
  assert.match(line(briefing(plan, [], null)), /^4900 FT · ASSUMED/);
  assert.match(line(briefing(plan, [], null, { km: 0.9, stations: 7 })), /^3000 FT · FROM 7 STATIONS$/);
  assert.match(line(briefing({ ...plan, altitude: 1600 }, [], null, { km: 2.1, stations: 1 })), /FROM 1 STATION · FL052 IS UNDER IT/);
});
