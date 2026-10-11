import assert from "node:assert/strict";
import test from "node:test";
import { canPlay, nextFrame, type LoopState } from "../../src/lib/playbackLoop.ts";

/**
 * The play button where the screen has no forecast: off from now on, and from
 * the past a loop over the past radar that never runs into the washed-out
 * forecast.
 */

const MIN = 60;
const NOW = 1_800_000_000;
const state = (overrides: Partial<LoopState>): LoopState => ({
  shown: NOW,
  latestObservation: NOW,
  now: NOW,
  lastStep: NOW + 120 * MIN,
  start: NOW - 120 * MIN,
  loopFrom: NOW,
  fromStart: false,
  noForecast: false,
  ...overrides,
});

test("play is off with no radar on screen", () => {
  assert.equal(canPlay({ outOfRadar: true, noForecast: false, shown: NOW - 30 * MIN, latestObservation: NOW }), false);
});

test("with no forecast, play is off on now and on", () => {
  assert.equal(canPlay({ outOfRadar: false, noForecast: true, shown: NOW, latestObservation: NOW }), false);
  assert.equal(canPlay({ outOfRadar: false, noForecast: true, shown: NOW + 15 * MIN, latestObservation: NOW }), false);
});

test("with no forecast, play is on in the past", () => {
  assert.equal(canPlay({ outOfRadar: false, noForecast: true, shown: NOW - 5 * MIN, latestObservation: NOW }), true);
});

test("with a forecast, play is on anywhere", () => {
  assert.equal(canPlay({ outOfRadar: false, noForecast: false, shown: NOW + 60 * MIN, latestObservation: NOW }), true);
});

test("a full playback steps into the forecast and wraps to now at its end", () => {
  assert.equal(nextFrame(state({ shown: NOW })), NOW + 5 * MIN);
  assert.equal(nextFrame(state({ shown: NOW + 120 * MIN })), NOW);
});

test("with no forecast, playback stops at now and goes back to where it was started", () => {
  const loop = state({ noForecast: true, loopFrom: NOW - 15 * MIN });
  assert.equal(nextFrame({ ...loop, shown: NOW - 5 * MIN }), NOW);
  assert.equal(nextFrame({ ...loop, shown: NOW }), NOW - 15 * MIN);
});

test("with no forecast and play-from-start, the loop goes back to the start", () => {
  assert.equal(nextFrame(state({ noForecast: true, fromStart: true, loopFrom: NOW - 15 * MIN })), NOW - 120 * MIN);
});

test("a forecast lost mid-playback ends the loop on the next frame, not in the wash", () => {
  // Panned away from the forecast while playing through it: started on now.
  assert.equal(nextFrame(state({ noForecast: true, shown: NOW + 30 * MIN, loopFrom: NOW })), NOW - 120 * MIN);
});
