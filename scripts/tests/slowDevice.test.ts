import assert from "node:assert/strict";
import test from "node:test";

const { droppedShare, verdictFor, FRAMES_NEEDED, SLOW_SHARE } = await import("../../src/lib/slowDevice.ts");

/**
 * A touch device is judged once, by how it moves the map: one that drops more
 * than a quarter of its frames gets the solid glass while moving.
 */

const frames = (ms: number, n: number) => Array.from({ length: n }, () => ms);

test("no verdict until the map has been moved for long enough", () => {
  assert.equal(verdictFor(frames(16.7, FRAMES_NEEDED - 1)), null);
});

test("a phone that keeps up is fine, at 60 Hz or at 120", () => {
  assert.equal(verdictFor(frames(16.7, FRAMES_NEEDED)), "fine");
  assert.equal(verdictFor(frames(8.3, FRAMES_NEEDED * 2)), "fine");
});

test("the odd long frame does not make a phone slow", () => {
  // One hitch a gesture -- a tile landing, the labels placed again.
  const intervals = [...frames(16.7, FRAMES_NEEDED), 120, 120, 120];
  assert.equal(verdictFor(intervals), "fine");
});

test("a phone at 30 frames a second is slow", () => {
  assert.ok(droppedShare(frames(33.4, FRAMES_NEEDED)) > SLOW_SHARE);
  assert.equal(verdictFor(frames(33.4, FRAMES_NEEDED)), "slow");
});

test("a long interval counts every frame it swallowed", () => {
  // 150 ms at 60 Hz is eight frames missed, not one.
  assert.equal(droppedShare([150]), 8 / 9);
});
