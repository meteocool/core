import assert from "node:assert/strict";
import test from "node:test";
import {
  isLive, LIVE_MINUTES, pulseRing, pulseStep,
} from "../../src/lib/cellPulse.ts";

/**
 * The ping on a live cell: a ring that grows out of the centroid and fades.
 *
 * The shape of the fade is the part worth pinning down. Linear, the ring is
 * still clearly visible when it is far enough from its marker to be ambiguous
 * about which cell it came from -- on a map with a dozen live cells in a line
 * that reads as a mess rather than as a dozen pings.
 */
test("the ring starts on the marker and grows away from it", () => {
  assert.ok(pulseRing(1).radius > pulseRing(0).radius);
  // Starting outside the marker, not inside it: the dot is up to 12px across.
  assert.ok(pulseRing(0).radius >= 7);
});

test("the ring is at its strongest as it leaves the marker", () => {
  assert.ok(pulseRing(0).alpha > pulseRing(0.5).alpha);
  assert.ok(pulseRing(0.5).alpha > pulseRing(0.99).alpha);
});

test("it is gone by the time it is far from the cell it came from", () => {
  assert.equal(pulseRing(1).alpha, 0);
  // Most of the fading is late, so the ring stays readable while it is close:
  // halfway out it still has a quarter of its strength, not none.
  assert.ok(pulseRing(0.5).alpha / pulseRing(0).alpha > 0.2);
});

test("the cycle is driven by the clock, so every cell pings together", () => {
  // In phase on purpose: a map where each cell runs its own cycle shimmers,
  // where one shared beat reads as the map itself being live.
  assert.equal(pulseStep(1_000_000), pulseStep(1_000_000));
  assert.notEqual(pulseStep(0), pulseStep(1100));
});

test("the step wraps rather than running away", () => {
  const steps = new Set<number>();
  for (let ms = 0; ms < 20_000; ms += 37) steps.add(pulseStep(ms));
  assert.ok(Math.min(...steps) >= 0);
  assert.ok(Math.max(...steps) < 20);
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
