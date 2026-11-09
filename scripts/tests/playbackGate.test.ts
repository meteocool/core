import assert from "node:assert/strict";
import test from "node:test";
import { READY_TIMEOUT_MS, holdsForTiles, playOrder, shouldAdvance, waitLeft } from "../../src/lib/playbackGate.ts";

/**
 * Playback moves on to a frame once its tiles are decoded, and holds the one
 * on screen meanwhile, but never for long.
 */

test("a frame whose tiles are ready is moved on to at once", () => {
  assert.equal(shouldAdvance(true, 0), true);
});

test("a frame not ready is waited for", () => {
  assert.equal(shouldAdvance(false, 0), false);
  assert.equal(shouldAdvance(false, READY_TIMEOUT_MS - 1), false);
});

test("waited for long enough, playback moves on regardless", () => {
  assert.equal(shouldAdvance(false, READY_TIMEOUT_MS), true);
  assert.equal(shouldAdvance(false, 200, 100), true);
});

test("the wait left shrinks with the wait so far, and never goes below nothing", () => {
  assert.equal(waitLeft(0), READY_TIMEOUT_MS);
  assert.equal(waitLeft(400, 1000), 600);
  assert.equal(waitLeft(5000, 1000), 0);
});

test("playback waits only while frames are being decoded ahead", () => {
  assert.equal(holdsForTiles("all"), true);
  assert.equal(holdsForTiles("ahead"), true);
  assert.equal(holdsForTiles("none"), false, "with nothing filling the store, a wait would only time out");
});

test("the longest hold is a few frames of playback, not a stall", () => {
  assert.ok(READY_TIMEOUT_MS >= 1000 && READY_TIMEOUT_MS <= 2000);
});

test("playing, the steps to decode are those the loop shows next, in its order, once round", () => {
  // A loop from now (600) to the forecast's end (1200), back to now.
  const next = (shown: number) => (shown >= 1200 ? 600 : shown + 300);
  assert.deepEqual(playOrder(900, next, 10), [900, 1200, 600]);
  assert.deepEqual(playOrder(900, next, 2), [900, 1200]);
});

test("a loop that never comes back to where it started stops when it repeats itself", () => {
  // Started on a step the loop does not return to (before where it wraps to).
  const next = (shown: number) => (shown >= 900 ? 600 : shown + 300);
  assert.deepEqual(playOrder(300, next, 10), [300, 600, 900]);
});
