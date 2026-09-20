import assert from "node:assert/strict";
import test from "node:test";
import { cellRecency, radarOffsetLabel, SAME_FRAME_MINUTES } from "../../src/lib/cellRecency.ts";

const MIN = 60_000;
const now = 1_000 * MIN;

test("age is measured from the detection to the clock", () => {
  assert.equal(cellRecency(now - 4 * MIN, now, null).ageMinutes, 4);
});

test("a detection stamped ahead of the clock reads as current, not negative", () => {
  // Clock skew between the client and the backend, not a reading from the
  // future; "-2 min ago" is worse than saying nothing.
  assert.equal(cellRecency(now + 2 * MIN, now, null).ageMinutes, 0);
});

test("with no radar grid there is nothing to compare against", () => {
  assert.equal(cellRecency(now, now, null).behindMinutes, null);
  assert.equal(radarOffsetLabel(null), null);
});

test("the two products on the same step say nothing", () => {
  // The panel is busy enough without a line confirming nothing is wrong.
  assert.equal(radarOffsetLabel(0), null);
  assert.equal(radarOffsetLabel(SAME_FRAME_MINUTES - 0.1), null);
  assert.equal(radarOffsetLabel(-(SAME_FRAME_MINUTES - 0.1)), null);
});

test("a detection a frame behind the radar says so", () => {
  const { behindMinutes } = cellRecency(now - 10 * MIN, now, now - 5 * MIN);
  assert.equal(behindMinutes, 5);
  assert.equal(radarOffsetLabel(behindMinutes), "5 min behind the radar");
});

test("a detection ahead of the composite is reported rather than rounded away", () => {
  assert.equal(radarOffsetLabel(-5), "5 min ahead of the radar");
});

test("the offset is against the radar frame, not the clock", () => {
  // Both stale by half an hour, but in step with each other: the numbers in
  // the panel and the pixels behind them still describe the same moment.
  const { ageMinutes, behindMinutes } = cellRecency(now - 30 * MIN, now, now - 30 * MIN);
  assert.equal(ageMinutes, 30);
  assert.equal(behindMinutes, 0);
  assert.equal(radarOffsetLabel(behindMinutes), null);
});
