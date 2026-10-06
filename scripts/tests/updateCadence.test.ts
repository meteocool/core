import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_CADENCE, MAX_GAP_S, MIN_INTERVALS, overdueBy, publishCadence,
} from "../../src/lib/updateCadence.ts";

/**
 * The prediction behind "next update expected", and behind the degraded
 * criterion that decides the backend has stopped publishing. Both are only as
 * good as the rhythm measured here, and a rhythm measured from the wrong
 * numbers is worse than none: it would call a healthy backend late.
 */

/** A run of `count` publishes `every` seconds apart, ending at `last`. */
const series = (last: number, every: number, count: number) => (
  Array.from({ length: count }, (_unused, i) => last - (count - 1 - i) * every)
);

test("nothing observed yet has no opinion", () => {
  const cadence = publishCadence([]);
  assert.deepEqual(cadence, EMPTY_CADENCE);
  assert.equal(overdueBy(cadence, 1_000), null);
});

test("too few intervals is not a pattern", () => {
  const cadence = publishCadence(series(1000, 300, MIN_INTERVALS));
  // MIN_INTERVALS publishes is MIN_INTERVALS - 1 gaps.
  assert.equal(cadence.periodS, null);
  assert.equal(cadence.nextAt, null);
  assert.equal(cadence.lastAt, 1000, "the last publish is still known");
});

test("a steady cycle is read back exactly, and predicts the next one", () => {
  const cadence = publishCadence(series(10_000, 300, 12));
  assert.equal(cadence.periodS, 300);
  assert.equal(cadence.samples, 11);
  assert.equal(cadence.lastAt, 10_000);
  assert.equal(cadence.nextAt, 10_300);
});

test("unsorted input is the same input", () => {
  const ordered = publishCadence(series(10_000, 300, 12));
  const shuffled = publishCadence([...series(10_000, 300, 12)].reverse());
  assert.deepEqual(shuffled, ordered);
});

test("duplicate timestamps do not report a cadence of zero", () => {
  /* Every forecast frame in a grid is rebuilt on one pass and stamped with the
     same processed_time. Counted as gaps, those zeros would be the median. */
  const times = [...series(10_000, 300, 12), 10_000, 10_000, 10_000, 10_000];
  assert.equal(publishCadence(times).periodS, 300);
});

test("a jittery cycle takes the median, not the mean", () => {
  // One eight-minute gap among five-minute ones must not move the prediction.
  const cadence = publishCadence([0, 300, 600, 900, 1380, 1680, 1980]);
  assert.equal(cadence.periodS, 300);
});

test("a hole in the record is not part of the rhythm", () => {
  // A tab asleep for two hours, then the usual cycle resumes.
  const cadence = publishCadence([0, MAX_GAP_S + 5000, MAX_GAP_S + 5300,
    MAX_GAP_S + 5600, MAX_GAP_S + 5900, MAX_GAP_S + 6200]);
  assert.equal(cadence.periodS, 300);
  assert.equal(cadence.samples, 4, "the outlying gap is dropped, not clamped");
});

test("overdue is negative while the next publish is still due", () => {
  const cadence = publishCadence(series(10_000, 300, 12));
  assert.equal(overdueBy(cadence, 10_100), -200);
  assert.equal(overdueBy(cadence, 10_300), 0);
  assert.equal(overdueBy(cadence, 10_600), 300);
});

test("a publish that lands clears the overdue reading on its own", () => {
  // The criterion measures from the newest publish, not from when we noticed,
  // so the next frame is all it takes -- nothing has to reset anything.
  let cadence = publishCadence(series(10_000, 300, 12));
  assert.ok((overdueBy(cadence, 10_900) ?? 0) > 0);
  cadence = publishCadence(series(10_900, 300, 12));
  assert.ok((overdueBy(cadence, 10_900) ?? 0) < 0);
});
