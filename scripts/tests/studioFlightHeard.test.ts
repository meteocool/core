import assert from "node:assert/strict";
import test from "node:test";
import { ENGINE_HEARD, heardFrom } from "../../src/lib/studio/flight/soundMix.ts";

test("from behind or ahead the engines are in the middle; from a side, the roar to the tail's side and the tone to the nose's", () => {
  for (const yaw of [0, 180]) {
    const heard = heardFrom(yaw, 60);
    assert.ok(Math.abs(heard.roarPan) < 1e-9 && Math.abs(heard.fanPan) < 1e-9);
  }
  // 90: the eye on the left, the nose to its left and the tail to its right.
  const left = heardFrom(90, 60);
  assert.ok(left.roarPan > 0.5 && left.fanPan < -0.1, JSON.stringify(left));
  const right = heardFrom(-90, 60);
  assert.ok(right.roarPan < -0.5 && right.fanPan > 0.1);
});

test("further off the engines close in on the middle, fall quieter and, far enough, are gone", () => {
  const near = heardFrom(90, 40);
  const far = heardFrom(90, 300);
  assert.ok(Math.abs(far.roarPan) < Math.abs(near.roarPan));
  assert.ok(far.level < near.level && far.level > 0);
  assert.equal(heardFrom(90, ENGINE_HEARD.fades[1]).level, 0);
  assert.equal(heardFrom(0, 600).level, 0);
});

test("behind it the roar is loudest, ahead of it the fans' tone", () => {
  const behind = heardFrom(0, 60);
  const ahead = heardFrom(180, 60);
  assert.ok(behind.roar > ahead.roar && ahead.fan > behind.fan);
});
