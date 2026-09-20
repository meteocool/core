import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSUMED_PERIOD_S, OUTDATED_GRACE_S, expectedPeriodS, isOutdated,
} from "../../src/lib/freshness.ts";
import { EMPTY_CADENCE, publishCadence } from "../../src/lib/updateCadence.ts";

/**
 * The rule that decides a tab which has been asleep is looking at frames that
 * have been overtaken. It runs the moment the page wakes, before anything has
 * been refetched, so getting it wrong is visible either way: too eager and the
 * map flashes a warning every time it is glanced at, too lax and a phone out of
 * a pocket quietly shows twenty-minute-old rain as current.
 */

/** A steady run of publishes, the shape publishCadence() learns from. */
const steady = (last: number, every: number, count: number) => publishCadence(
  Array.from({ length: count }, (_unused, i) => last - (count - 1 - i) * every),
);

test("with no rhythm learned yet, the nominal cycle is assumed", () => {
  assert.equal(expectedPeriodS(EMPTY_CADENCE), ASSUMED_PERIOD_S);
});

test("a learned rhythm wins over the nominal one", () => {
  assert.equal(expectedPeriodS(steady(10_000, 120, 12)), 120);
});

test("no grid yet is loading, not outdated", () => {
  assert.equal(isOutdated(null, 10_000, EMPTY_CADENCE), false);
  assert.equal(isOutdated(0, 10_000, EMPTY_CADENCE), false);
});

test("a frame within its own cycle is current", () => {
  const now = 100_000;
  assert.equal(isOutdated(now - 10, now, EMPTY_CADENCE), false);
  assert.equal(isOutdated(now - ASSUMED_PERIOD_S, now, EMPTY_CADENCE), false);
});

test("the grace absorbs ordinary pipeline lag just past a cycle", () => {
  const now = 100_000;
  const stillFine = now - ASSUMED_PERIOD_S - OUTDATED_GRACE_S;
  assert.equal(isOutdated(stillFine, now, EMPTY_CADENCE), false);
  assert.equal(isOutdated(stillFine - 1, now, EMPTY_CADENCE), true);
});

test("a tab that slept through several cycles is outdated", () => {
  const now = 100_000;
  assert.equal(isOutdated(now - 20 * 60, now, EMPTY_CADENCE), true);
});

test("a backend on a faster cycle goes outdated sooner", () => {
  const now = 100_000;
  const cadence = steady(now - 60, 60, 12);
  // Six minutes: well inside the assumed five-minute cycle plus grace, well
  // outside a measured one-minute cycle plus the same grace.
  assert.equal(isOutdated(now - 360, now, EMPTY_CADENCE), false);
  assert.equal(isOutdated(now - 360, now, cadence), true);
});

test("a clock behind the newest frame is not outdated", () => {
  // Forecast frames are stamped in the future; nothing here should read that
  // as negative age meaning anything.
  assert.equal(isOutdated(100_600, 100_000, EMPTY_CADENCE), false);
});
