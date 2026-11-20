import assert from "node:assert/strict";
import test from "node:test";
import { Keys } from "../../src/lib/studio/flight/controls.ts";
import { levelFlight, NO_INPUT, step, STILL_AIR } from "../../src/lib/studio/flight/physics.ts";
import {
  axisInput, LEVER_IDLE, LEVER_IDLE_REST, LEVER_REVERSE, leverAt, leverRate, leverShare, pinchSteps, STICK_DEAD, stickInput, tiltInput,
  tiltOf,
} from "../../src/lib/studio/flight/touch.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/* ---- the stick ---- */

test("the stick has the keys' signs: pulled down the screen is nose up, right rolls right", () => {
  const back = stickInput(0, 50, 50);
  assert.equal(back.roll, 0);
  near(back.pitch, 1, 1e-9);
  near(stickInput(0, -50, 50).pitch, -1, 1e-9);
  near(stickInput(50, 0, 50).roll, 1, 1e-9);
  near(stickInput(-50, 0, 50).roll, -1, 1e-9);
});

test("a thumb resting near the middle of the stick asks nothing, and a little past it asks a little", () => {
  assert.deepEqual(stickInput(3, -4, 50), { roll: 0, pitch: 0, x: 3, y: -4 });
  const edge = stickInput(50 * STICK_DEAD + 1, 0, 50);
  assert.ok(edge.roll > 0 && edge.roll < 0.02, String(edge.roll));
  // Half the travel is well under half of what the aircraft is asked: fine near the middle.
  const half = stickInput(25, 0, 50).roll;
  assert.ok(half > 0.15 && half < 0.4, String(half));
  // And it only ever grows with the travel.
  let before = 0;
  for (let px = 0; px <= 50; px += 1) {
    const { roll } = stickInput(px, 0, 50);
    assert.ok(roll >= before);
    before = roll;
  }
});

test("past the rim the knob stays on it, and a diagonal asks no more than all of the stick", () => {
  const far = stickInput(300, 400, 50);
  near(Math.hypot(far.x, far.y), 50, 1e-9);
  near(Math.hypot(far.roll, far.pitch), 1, 1e-9);
  near(far.pitch / far.roll, 4 / 3, 1e-9);
  // Nothing of a stick with no travel at all.
  assert.deepEqual(stickInput(0, 0, 0), { roll: 0, pitch: 0, x: 0, y: 0 });
});

test("one axis alone, the rudder's, reads the same way", () => {
  assert.equal(axisInput(2, 60), 0);
  near(axisInput(60, 60), 1, 1e-9);
  near(axisInput(-90, 60), -1, 1e-9);
  assert.ok(axisInput(30, 60) > 0 && axisInput(30, 60) < 0.5);
});

/* ---- the throttle lever ---- */

test("the lever's track: the reversers below idle, a notch at idle, and thrust above it", () => {
  assert.deepEqual(leverAt(0), { lever: 0, reverse: true });
  assert.deepEqual(leverAt(LEVER_REVERSE - 0.01), { lever: 0, reverse: true });
  // Anywhere in the notch is idle.
  assert.deepEqual(leverAt(LEVER_REVERSE), { lever: 0, reverse: false });
  assert.deepEqual(leverAt(LEVER_IDLE_REST), { lever: 0, reverse: false });
  assert.deepEqual(leverAt(LEVER_IDLE), { lever: 0, reverse: false });
  near(leverAt(1).lever, 1, 1e-9);
  near(leverAt((1 + LEVER_IDLE) / 2).lever, 0.5, 1e-9);
  assert.equal(leverAt(1.4).lever, 1);
});

test("a throttle is drawn where the lever would have put it", () => {
  assert.equal(leverShare(0), LEVER_IDLE_REST);
  assert.equal(leverShare(1), 1);
  for (const throttle of [0.1, 0.35, 0.8]) near(leverAt(leverShare(throttle)).lever, throttle, 1e-9);
});

test("the throttle comes to where the lever was put, and stops there", () => {
  for (const [from, lever] of [[0.2, 0.7], [0.9, 0.3], [0.5, 1], [0.6, 0]] as const) {
    let state = { ...levelFlight(4.6, 43.3, 3000, 90, 140), throttle: from };
    let rate = leverRate(lever, state.throttle);
    assert.equal(Math.sign(rate), Math.sign(lever - from));
    // A frame at a time, as the controls do it: this frame's rate from the last frame's throttle.
    for (let frame = 0; frame < 60 * 8; frame += 1) {
      const before = state.throttle;
      state = step(state, { ...NO_INPUT, throttle: rate }, 1 / 60, STILL_AIR);
      // Never past it: nearer every frame, from the same side.
      assert.ok(Math.abs(lever - state.throttle) <= Math.abs(lever - before) + 1e-12);
      assert.ok((lever - state.throttle) * (lever - from) >= 0, `${state.throttle} is past ${lever}`);
      rate = leverRate(lever, state.throttle);
    }
    near(state.throttle, lever, 0.005);
    assert.equal(rate, 0);
  }
});

test("idle and full thrust are reached exactly, and slow frames do not overshoot", () => {
  let state = { ...levelFlight(4.6, 43.3, 3000, 90, 140), throttle: 0.4 };
  for (let frame = 0; frame < 100; frame += 1) {
    // A tenth of a second a frame: the longest one the flight takes.
    const rate = leverRate(0, state.throttle);
    for (let left = 0.1; left > 1e-6; left -= 0.02) state = step(state, { ...NO_INPUT, throttle: rate }, 0.02, STILL_AIR);
  }
  assert.equal(state.throttle, 0);
  assert.equal(leverRate(0, 0), 0);
  assert.equal(leverRate(1, 1), 0);
  assert.ok(leverRate(1, 0.999) >= 0.25);
});

/* ---- the phone as a yoke ---- */

test("how a phone is held, upright or on its side, whichever way the page is turned", () => {
  // Upright in the hand, the page as the phone is.
  near(tiltOf(90, 0, 0).back, 0, 1e-6);
  near(tiltOf(90, 0, 0).side, 0, 1e-6);
  // Flat on a table.
  near(tiltOf(0, 0, 0).back, 90, 1e-6);
  // Half tipped back, and its right side down from there.
  near(tiltOf(45, 0, 0).back, 45, 1e-6);
  assert.ok(tiltOf(45, 20, 0).side > 10);
  assert.ok(tiltOf(45, -20, 0).side < -10);
  // On its side, top to the left, flat: tipped back as flat is, and not to either side.
  near(tiltOf(0, 0, 90).back, 90, 1e-6);
  near(tiltOf(0, 0, 90).side, 0, 1e-6);
  // Held there as a page is read, the far long edge raised: with its top to the left that edge is the phone's right side.
  const read = tiltOf(0, -45, 90);
  near(read.back, 45, 1e-6);
  near(read.side, 0, 1e-6);
  // Turned the other way up, the far edge is its left side, and the hold reads the same.
  near(tiltOf(0, 45, 270).back, 45, 1e-6);
  // The picture's right side down: the phone's bottom, with its top to the left; its top, the other way up.
  assert.ok(tiltOf(20, -45, 90).side > 5);
  near(tiltOf(-20, -45, 90).side, -tiltOf(20, -45, 90).side, 1e-6);
  near(tiltOf(-20, 45, 270).side, tiltOf(20, -45, 90).side, 1e-6);
});

test("tilt flies from how the phone was held when it began", () => {
  const neutral = tiltOf(0, -45, 90);
  assert.deepEqual(tiltInput(neutral, neutral), { roll: 0, pitch: 0 });
  // A hand is never quite still: a degree or two is nothing.
  assert.deepEqual(tiltInput({ back: neutral.back + 2, side: neutral.side - 2 }, neutral), { roll: 0, pitch: 0 });
  // Its top brought towards the reader, more upright: the yoke pulled back.
  assert.ok(tiltInput({ back: neutral.back - 12, side: neutral.side }, neutral).pitch > 0.3);
  assert.ok(tiltInput({ back: neutral.back + 12, side: neutral.side }, neutral).pitch < -0.3);
  assert.ok(tiltInput({ back: neutral.back, side: neutral.side + 15 }, neutral).roll > 0.3);
  // And no more than all of the stick, however far.
  assert.deepEqual(tiltInput({ back: neutral.back - 80, side: neutral.side - 80 }, neutral), { roll: -1, pitch: 1 });
});

/* ---- two fingers ---- */

test("fingers spread apart bring the eye nearer, by the wheel's steps", () => {
  near(pinchSteps(100, 110), -1, 1e-9);
  near(pinchSteps(110, 100), 1, 1e-9);
  assert.equal(pinchSteps(100, 100), 0);
  assert.equal(pinchSteps(0, 100), 0);
});

/* ---- beside the keys ---- */

test("the touch controls are a third hand on the keys: whichever is pushed further, and gone when let go of", () => {
  const keys = new Keys(() => undefined);
  assert.deepEqual(keys.read(), { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false, warp: false });
  keys.setTouch({ pitch: 0.4, roll: -0.2, yaw: 0, throttle: 1, brake: true, warp: true });
  assert.deepEqual(keys.read(), { pitch: 0.4, roll: -0.2, yaw: 0, throttle: 1, brake: true, warp: true });
  assert.ok(Keys.moving(keys.read()));
  keys.setTouch(null);
  assert.ok(!Keys.moving(keys.read()));
  // Stopping lets go of them too.
  keys.setTouch({ pitch: 1, roll: 0, yaw: 0, throttle: 0, brake: false, warp: false });
  keys.stop();
  assert.equal(keys.read().pitch, 0);
});
