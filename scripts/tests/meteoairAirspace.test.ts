import assert from "node:assert/strict";
import test from "node:test";
import { encodeState, limitsOf, readMessage, readSnapshot, writeSnapshot, PAUSED, GEAR_DOWN, STATE_BYTES, DEFAULT_LIMITS } from "../../src/lib/studio/flight/airspace/wire.ts";
import type { HeardAircraft, OwnState } from "../../src/lib/studio/flight/airspace/wire.ts";
import { decodeLook, encodeLook, INTACT, lookOf } from "../../src/lib/studio/flight/airspace/look.ts";
import type { Look } from "../../src/lib/studio/flight/airspace/look.ts";
import { afterClose, FRESH, FrameBudget, sendEveryMs } from "../../src/lib/studio/flight/airspace/plan.ts";
import { Traffic, CARRY_MS, FADE_MS } from "../../src/lib/studio/flight/airspace/traffic.ts";
import { AS_LIGHT, AS_MODEL, AS_SILHOUETTE, budgetFor, choose, NOT_DRAWN } from "../../src/lib/studio/flight/airspace/budget.ts";
import { contrailStrength, SEGMENT_FLOATS, Trail } from "../../src/lib/studio/flight/airspace/trails.ts";
import { Sky } from "../../src/lib/studio/flight/airspace/sky.ts";
import { intact } from "../../src/lib/studio/flight/damage.ts";

const state = (change: Partial<OwnState> = {}): OwnState => ({
  flags: 0, lon: 9.5, lat: 50.4, altitude: 10_000, east: 200, north: 0, up: 0, heading: 90, pitch: 2, roll: -5, look: encodeLook(INTACT), ...change,
});

test("a state is 36 bytes, little-endian, as the airspace reads it", () => {
  const view = encodeState(state({
    flags: GEAR_DOWN | PAUSED, lon: -0.1234567, lat: 51.5, altitude: 123.45, east: -12.34, north: 3276.8, up: 1.25, heading: 359.99, pitch: 95, roll: 190,
  }), 0x1_0002);
  assert.equal(view.byteLength, STATE_BYTES);
  assert.equal(view.getUint8(0), 1);
  assert.equal(view.getUint8(1), GEAR_DOWN | PAUSED);
  assert.equal(view.getUint16(2, true), 2, "the counter wraps");
  assert.equal(view.getInt32(4, true), -1_234_567);
  assert.equal(view.getInt32(8, true), 515_000_000);
  assert.equal(view.getInt32(12, true), 12_345);
  assert.equal(view.getInt16(16, true), -123);
  assert.equal(view.getInt16(18, true), 32767, "held to the field");
  assert.equal(view.getInt16(20, true), 13);
  assert.equal(view.getUint16(22, true), 65534);
  assert.equal(view.getInt16(24, true), 9000, "pitch held to straight up");
  assert.equal(view.getInt16(26, true), -17000, "roll wrapped");
  assert.equal(view.getUint8(28), 1, "the look's version");
});

test("a snapshot reads back what was written, and a frame of the wrong length is let go of", () => {
  const frame = writeSnapshot(4_000_000_000, [
    { id: 17, ageMs: 120, state: state() },
    { id: 23, ageMs: 9999, state: state({ lat: 48, flags: PAUSED }) },
  ]);
  const heard: Array<HeardAircraft & { clock: number }> = [];
  assert.equal(readSnapshot(frame, (aircraft, clock) => heard.push({ ...aircraft, look: aircraft.look.slice(), clock })), 2);
  assert.equal(heard[0].id, 17);
  assert.equal(heard[0].ageMs, 120);
  assert.equal(heard[0].clock, 4_000_000_000);
  assert.ok(Math.abs(heard[0].lon - 9.5) < 1e-7);
  assert.equal(heard[0].east, 200);
  assert.ok(Math.abs(heard[0].heading - 90) < 0.01);
  assert.equal(heard[1].ageMs, 2550, "an age of 255 is that or more");
  assert.equal(heard[1].flags, PAUSED);
  assert.equal(heard[1].look[0], 1);
  assert.equal(readSnapshot(frame.slice(0, frame.byteLength - 1), () => assert.fail()), -1);
  assert.equal(readSnapshot(new ArrayBuffer(3), () => assert.fail()), -1);
  const state1 = new Uint8Array(STATE_BYTES);
  state1[0] = 1;
  assert.equal(readSnapshot(state1.buffer, () => assert.fail()), -1, "a state is not a snapshot");
});

test("text frames: only the airspace's own are read, and limits only where they are numbers", () => {
  assert.equal(readMessage("nope"), null);
  assert.equal(readMessage(JSON.stringify({ type: "other" })), null);
  assert.deepEqual(readMessage(JSON.stringify({ type: "rate", send_hz: 5 })), { type: "rate", send_hz: 5 });
  const limits = limitsOf({ near: 10, silent_ms: "x", far: -1 });
  assert.equal(limits.near, 10);
  assert.equal(limits.silent_ms, DEFAULT_LIMITS.silent_ms);
  assert.equal(limits.far, DEFAULT_LIMITS.far);
});

test("look version 1 round-trips; an unknown version or a short one is an intact aircraft", () => {
  const look: Look = {
    flaps: 0.5, spoilers: 1, lost: { leftWing: true, rightWing: false, tail: true, surfaces: true }, crash: "blew",
    burning: 0b1000011, strength: 0.8, blast: { seed: 201, size: 26, ago: 3.27 },
  };
  const bytes = encodeLook(look);
  assert.equal(bytes.length, 8);
  assert.equal(bytes[0], 1);
  const back = decodeLook(bytes);
  assert.ok(Math.abs(back.flaps - 0.5) < 0.04);
  assert.equal(back.spoilers, 1);
  assert.deepEqual(back.lost, look.lost);
  assert.equal(back.crash, "blew");
  assert.equal(back.burning, 0b1000011);
  assert.ok(Math.abs(back.strength - 0.8) < 0.01);
  assert.deepEqual(back.blast, { seed: 201, size: 26, ago: 3.2 });
  // Long ago, the blast is over: not drawn again.
  assert.equal(decodeLook(encodeLook({ ...look, blast: { seed: 1, size: 26, ago: 40 } })).blast, null);
  for (const odd of [[2, 255, 255, 255, 255, 255, 255, 0], [1, 2, 3], [0, 0, 0, 0, 0, 0, 0, 0]]) {
    const read = decodeLook(odd);
    assert.equal(read.crash, "none");
    assert.equal(read.burning, 0);
    assert.equal(read.blast, null);
    assert.equal(read.lost.leftWing, false);
  }
});

test("the cockpit's own look: what burns, what has gone, and how long ago it blew up", () => {
  const damage = {
    ...intact(5), clock: 12, violence: 0.6, lost: { leftWing: true },
    fires: [{ on: "hull" as const, at: [1, 0, 0.6] as [number, number, number], size: 8, strength: 1, born: 10 },
      { on: "leftWing" as const, at: [0, 0, 0] as [number, number, number], size: 3, strength: 0.6, born: 10 }],
    blasts: [{ at: [0, 0, 1] as [number, number, number], size: 30, born: 10 }],
  };
  const look = lookOf({ flaps: 2, spoilers: 0, crash: "hard" }, damage);
  assert.equal(look.crash, "blew");
  assert.equal(look.lost.leftWing, true);
  assert.equal(look.burning & 1, 1, "the hull's middle");
  assert.equal(look.burning & 16, 16, "the left wing's root");
  assert.equal(look.blast?.ago, 2);
  assert.equal(look.blast?.size, 30);
  assert.equal(lookOf({ flaps: 0, spoilers: 0, crash: null }, intact()).crash, "none");
});

test("closes: each code as the airspace's table says", () => {
  const never = afterClose({ opened: false, code: 1006, openMs: 0 }, FRESH);
  assert.deepEqual(never.step, { then: "reopen", afterMs: 30_000 });
  let memory = never.memory;
  const waits = [];
  for (let i = 0; i < 6; i += 1) {
    const next = afterClose({ opened: false, code: 1006, openMs: 0 }, memory);
    waits.push((next.step as { afterMs: number }).afterMs);
    memory = next.memory;
  }
  assert.deepEqual(waits, [60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  for (const code of [4400, 4401, 4403, 4409, 4429]) assert.deepEqual(afterClose({ opened: true, code, openMs: 10 }, FRESH).step, { then: "nextFlight" });
  assert.deepEqual(afterClose({ opened: true, code: 4408, openMs: 60_000 }, FRESH).step, { then: "reopen", afterMs: 0 });
  const first = afterClose({ opened: true, code: 1006, openMs: 5000 }, FRESH);
  assert.deepEqual(first.step, { then: "reopen", afterMs: 3000 });
  const second = afterClose({ opened: true, code: 1012, openMs: 5000 }, first.memory);
  assert.deepEqual(second.step, { then: "reopen", afterMs: 6000 });
  assert.deepEqual(afterClose({ opened: true, code: 1006, openMs: 120_000 }, second.memory).step, { then: "reopen", afterMs: 3000 }, "steady again");
});

test("sending: as often as asked, within the most; and never more frames a second than allowed", () => {
  assert.equal(sendEveryMs(1, 5), 1000);
  assert.equal(sendEveryMs(5, 5), 200);
  assert.equal(sendEveryMs(50, 5), 200);
  assert.equal(sendEveryMs("x", 5), 1000);
  assert.equal(sendEveryMs(0.01, 5), 5000);
  const budget = new FrameBudget(8);
  let sent = 0;
  for (let t = 0; t < 1000; t += 50) {
    if (budget.may(t)) {
      budget.took(t);
      sent += 1;
    }
  }
  assert.equal(sent, 7, "one place kept for a join or a leave");
  assert.ok(budget.may(999, true));
  assert.ok(budget.may(1100));
});

/** A traffic store and a way to hear aircraft 17 at a place on a clock. */
function heardAt(clockStart: number) {
  const traffic = new Traffic();
  const hear = (localMs: number, lat: number, extra: Partial<OwnState> = {}, ageMs = 0) => {
    traffic.hear(writeSnapshot((clockStart + localMs) >>> 0, [{ id: 17, ageMs, state: state({ lat, east: 0, north: 100, ...extra }) }]), localMs);
  };
  return { traffic, hear };
}

for (const [name, start] of [["", 1_000_000], [" across the airspace clock's wrap", 2 ** 32 - 300]] as const) {
  test(`interpolation: drawn between two states, a little in the past${name}`, () => {
    const { traffic, hear } = heardAt(start);
    for (let t = 0; t <= 1000; t += 200) hear(t, 50 + t / 1e5);
    traffic.advance(1000);
    const [aircraft] = traffic.list;
    // Heard every 200 ms: drawn 380 ms back, between the states at 600 and 800.
    assert.ok(aircraft.delay > 300 && aircraft.delay < 450, String(aircraft.delay));
    const expected = 50 + (1000 - aircraft.delay) / 1e5;
    assert.ok(Math.abs(aircraft.shown.lat - expected) < 1e-7, `${aircraft.shown.lat} vs ${expected}`);
    assert.equal(aircraft.shown.opacity, 1);
  });
}

test("interpolation: carried on a second along its velocity, then faded, then forgotten", () => {
  const { traffic, hear } = heardAt(5000);
  for (let t = 0; t <= 1000; t += 200) hear(t, 50 + t / 1e5);
  traffic.advance(1000);
  const delay = traffic.list[0].delay;
  // The newest state was at 1000: past it by 500 ms, carried on 50 m north.
  traffic.advance(1500 + delay);
  const shown = traffic.list[0].shown;
  assert.ok(Math.abs((shown.lat - 50.01) * 111_195 - 50) < 1, String((shown.lat - 50.01) * 111_195));
  assert.equal(shown.opacity, 1);
  traffic.advance(1000 + CARRY_MS + 3000 + delay);
  assert.ok(Math.abs((traffic.list[0].shown.lat - 50.01) * 111_195 - 100) < 1, "no further than a second");
  assert.equal(traffic.list[0].shown.opacity, 0);
  traffic.advance(1000 + CARRY_MS + FADE_MS / 2 + delay);
  assert.ok(traffic.list[0].shown.opacity > 0.4 && traffic.list[0].shown.opacity < 0.6);
  const gone: number[] = [];
  traffic.advance(1000 + 10_001, (aircraft) => gone.push(aircraft.id));
  assert.deepEqual(gone, [17]);
  assert.equal(traffic.list.length, 0);
});

test("interpolation: one heard every two seconds is drawn further back; a paused one stands still", () => {
  const { traffic, hear } = heardAt(77);
  for (let t = 0; t <= 6000; t += 2000) hear(t, 50 + t / 1e5);
  traffic.advance(6000);
  assert.ok(traffic.list[0].delay > 2000, String(traffic.list[0].delay));
  assert.equal(traffic.list[0].shown.opacity, 1);
  const still = heardAt(77);
  still.hear(0, 50, { flags: PAUSED, north: 0 });
  still.hear(1000, 50, { flags: PAUSED, north: 0 });
  still.traffic.advance(1500);
  assert.equal(still.traffic.list[0].shown.lat, 50);
  assert.equal(still.traffic.list[0].shown.opacity, 1);
});

test("interpolation: the same state heard twice, and its age, count once; nonsense speeds are held", () => {
  const { traffic, hear } = heardAt(0);
  hear(0, 50);
  hear(200, 50.001, {}, 0);
  hear(400, 50.001, {}, 200);
  assert.equal(traffic.list[0].count, 2);
  hear(600, 50.002, { east: 30_000 });
  traffic.advance(600);
  assert.ok(Math.hypot(traffic.list[0].shown.east, traffic.list[0].shown.north) <= 1200.01);
});

test("budget: less of everything at less sharpness and on a phone; the nearest are models", () => {
  const desk = budgetFor(1, false);
  const phone = budgetFor(1, true);
  const low = budgetFor(0.1, false);
  for (const key of ["models", "silhouettes", "lights", "trailSegments", "burning"] as const) {
    assert.ok(phone[key] <= desk[key], key);
    assert.ok(low[key] <= desk[key], key);
  }
  const distance = new Float64Array([30_000, 1000, 2000, 3000, 10_000, Infinity, 500]);
  const kinds = new Uint8Array(distance.length);
  const order = new Uint16Array(distance.length);
  const chosen = choose(distance, distance.length, { models: 2, silhouettes: 2, lights: 1, trailSegments: 0, burning: 0 }, kinds, order);
  assert.deepEqual([...kinds], [NOT_DRAWN, AS_MODEL, AS_SILHOUETTE, AS_SILHOUETTE, AS_LIGHT, NOT_DRAWN, AS_MODEL]);
  assert.deepEqual(chosen, { models: 2, silhouettes: 2, lights: 1 });
  assert.deepEqual([...order.subarray(0, 3)], [6, 1, 2]);
});

test("contrails: from the cockpit's atmosphere and its rule; laid where the aircraft has been, and stay there", () => {
  assert.equal(contrailStrength(5000), 0);
  assert.equal(contrailStrength(11_000), 1);
  assert.ok(contrailStrength(11_000, 20) < 1, "warmer air, less of one");
  const sky = new Sky(10, 50);
  const trail = new Trail();
  for (let s = 0; s <= 10; s += 0.5) trail.follow(10 + s * 0.003, 50, 11_000, 1, s, sky);
  assert.ok(trail.count >= 6 && trail.count <= 8, String(trail.count));
  const out = new Float32Array(64 * SEGMENT_FLOATS);
  const origin: [number, number, number] = [sky.east(10.03), sky.north(50), sky.up(11_000)];
  const written = trail.write(out, 0, 64, sky, origin, [0, 0, 0], 1, 10);
  assert.equal(written, trail.count);
  // The oldest segment starts where the aircraft was at the start: two kilometres west of it.
  assert.ok(Math.abs(out[1] + 0.03 * 111_195 * Math.cos((50 * Math.PI) / 180)) < 60, String(out[1]));
  assert.ok(out[6] >= 9.5, "and it is ten seconds old");
  // At most so many.
  assert.equal(trail.write(out, 0, 2, sky, origin, [0, 0, 0], 1, 10), 2);
});
