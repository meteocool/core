import assert from "node:assert/strict";
import test from "node:test";
import {
  DASH, DASH_PERIOD, isLive, LIVE_MINUTES, TICK_MS, dashOffset,
} from "../../src/lib/cellPulse.ts";

/**
 * The ring that marks a live cell, stepping round it a notch at a time.
 *
 * It replaced an expanding-and-fading ping that rebuilt every live cell's
 * style twenty times a second and visibly failed to keep up with a hundred of
 * them on screen. Here the ring never changes shape: only the dash pattern's
 * offset moves, so the animation is a handful of prebuilt styles cycled in
 * order.
 */
test("a full turn is one dash and one gap, which is what the styles cost", () => {
  assert.equal(DASH_PERIOD, DASH[0] + DASH[1]);
  // The whole animation, cached: nine styles per colour rather than a new one
  // every frame.
  const offsets = new Set();
  for (let ms = 0; ms < TICK_MS * DASH_PERIOD * 3; ms += 10) offsets.add(dashOffset(ms));
  assert.equal(offsets.size, DASH_PERIOD);
});

test("it holds still between ticks rather than sweeping", () => {
  // The step is the point: smooth rotation at this size reads as a shimmer,
  // a notch reads as a mechanism running.
  assert.equal(dashOffset(0), dashOffset(TICK_MS - 1));
  assert.notEqual(dashOffset(0), dashOffset(TICK_MS));
});

test("the dashes travel the way the pattern is read", () => {
  // Positive offsets slide the pattern the other way, which looks like the
  // ring rotating backwards.
  for (let tick = 0; tick < DASH_PERIOD; tick += 1) {
    assert.ok(dashOffset(tick * TICK_MS) <= 0);
  }
});

test("every live cell steps together, off one clock", () => {
  // A map where each cell runs its own cycle shimmers; one shared beat reads
  // as the map itself being live.
  assert.equal(dashOffset(1_000_000), dashOffset(1_000_000));
  assert.equal(dashOffset(0), dashOffset(TICK_MS * DASH_PERIOD));
});

/**
 * Which cells the ping marks.
 *
 * The obvious candidate was the schema's own `active` -- "whether the cell was
 * still being detected recently". On the live backend it is true for every
 * track returned: 200 of 200 in one response, 147 of those last detected more
 * than fifteen minutes before the run's own reference time. It does not
 * separate the live storms from the stopped ones, so the timestamp does.
 */
test("a cell detected in the newest run is live", () => {
  assert.equal(isLive(0), true);
});

test("one missed detection does not take a live storm off the map", () => {
  // DWD's cadence is five-minutely, so a cell seen two runs ago is a cell that
  // missed one -- common, and not the same as a storm that has stopped.
  assert.equal(isLive(5), true);
  assert.equal(isLive(LIVE_MINUTES), true);
});

test("a cell that has stopped being detected stops pinging", () => {
  assert.equal(isLive(LIVE_MINUTES + 0.1), false);
  assert.equal(isLive(85), false);
});
