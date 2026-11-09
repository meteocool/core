import assert from "node:assert/strict";
import test from "node:test";
import {
  AROUND_FRAME_S, NO_PAST, frameInWindow, STEP_S, STRIKE_CHUNK_S, acceptsWindow, chunksFor, coverageDays, inWindow, isWindow,
  mapInWindow, nextWindowFrame, onGrid, pickWindow, sameWindow, shownIn, startMinutes, strikeAgeMinutes, strikeChunks,
  strikesAt, windowAround, windowEdgeClear, windowLabelEvery, windowSteps, windowTicks,
} from "../../src/lib/archive.ts";

/**
 * The archive's rules: which steps a past window holds and how its strip is
 * labelled, which pieces of strikes a step needs and which are drawn, and
 * what the map hides while one is open.
 */

/** 2026-11-01 00:00 UTC, on every grid there is. */
const DAY = 1_793_491_200;
const HOUR = 3600;
const COVERAGE = { since: DAY - 30 * 24 * HOUR, until: DAY + 12 * HOUR };
/** UTC days, as the tests' calendar: the reader's is handed in the same way. */
const utcDay = (ms: number) => ms - (ms % 86_400_000);
const nextUtcDay = (ms: number) => ms + 86_400_000;
const utcMinute = (ms: number) => Math.floor((ms % 86_400_000) / 60_000);

test("a time snaps to the five-minute step at or before it", () => {
  assert.equal(onGrid(DAY + 299), DAY);
  assert.equal(onGrid(DAY + 300), DAY + 300);
  assert.equal(onGrid(DAY - 1), DAY - 300);
});

test("a window holds every step from its start to its end, both shown", () => {
  const steps = windowSteps({ start: DAY, end: DAY + HOUR });
  assert.equal(steps.length, 13);
  assert.equal(steps[0], DAY);
  assert.equal(steps.at(-1), DAY + HOUR);
  assert.ok(steps.every((t, i) => i === 0 || t - steps[i - 1] === STEP_S));
});

test("a window is whole steps, ends after it starts, and fits the route's thousand steps", () => {
  assert.equal(isWindow({ start: DAY, end: DAY + HOUR }), true);
  assert.equal(isWindow({ start: DAY + 1, end: DAY + HOUR }), false);
  assert.equal(isWindow({ start: DAY, end: DAY }), false);
  assert.equal(isWindow({ start: DAY + HOUR, end: DAY }), false);
  assert.equal(isWindow({ start: DAY, end: DAY + 999 * STEP_S }), true);
  assert.equal(isWindow({ start: DAY, end: DAY + 1000 * STEP_S }), false);
  assert.equal(isWindow(null), false);
});

test("a step is in a window only if it is one of its steps", () => {
  const window = { start: DAY, end: DAY + HOUR };
  assert.equal(inWindow(window, DAY), true);
  assert.equal(inWindow(window, DAY + HOUR), true);
  assert.equal(inWindow(window, DAY + HOUR + STEP_S), false);
  assert.equal(inWindow(window, DAY + 1), false);
});

test("two windows are the same when both ends are, and live is only live", () => {
  assert.equal(sameWindow({ start: DAY, end: DAY + HOUR }, { start: DAY, end: DAY + HOUR }), true);
  assert.equal(sameWindow({ start: DAY, end: DAY + HOUR }, { start: DAY, end: DAY + 2 * HOUR }), false);
  assert.equal(sameWindow(null, null), true);
  assert.equal(sameWindow(null, { start: DAY, end: DAY + HOUR }), false);
});

test("a picked window runs its length from its start", () => {
  assert.deepEqual(pickWindow(DAY - 6 * HOUR, 3, COVERAGE), { start: DAY - 6 * HOUR, end: DAY - 3 * HOUR });
});

test("a picked start off the grid is moved back onto it", () => {
  assert.deepEqual(pickWindow(DAY + 61, 1, COVERAGE), { start: DAY, end: DAY + HOUR });
});

test("a picked window running past the archive's newest step ends there", () => {
  assert.deepEqual(pickWindow(DAY + 11 * HOUR, 6, COVERAGE), { start: DAY + 11 * HOUR, end: COVERAGE.until });
});

test("a picked window starting before the archive's oldest step starts there", () => {
  assert.deepEqual(pickWindow(COVERAGE.since - HOUR, 3, COVERAGE), { start: COVERAGE.since, end: COVERAGE.since + 2 * HOUR });
});

test("a picked window with nothing of it kept is none", () => {
  assert.equal(pickWindow(COVERAGE.until + HOUR, 1, COVERAGE), null);
});

test("a frame older than the live timeline opens two hours ending on it", () => {
  assert.deepEqual(windowAround(DAY, COVERAGE), { start: DAY - AROUND_FRAME_S, end: DAY });
});

test("a frame near the archive's start opens a window cut at the start", () => {
  assert.deepEqual(windowAround(COVERAGE.since + HOUR, COVERAGE), { start: COVERAGE.since, end: COVERAGE.since + HOUR });
});

test("a frame outside the archive, or off the grid, opens no window", () => {
  assert.equal(windowAround(COVERAGE.until + STEP_S, COVERAGE), null);
  assert.equal(windowAround(COVERAGE.since - STEP_S, COVERAGE), null);
  assert.equal(windowAround(COVERAGE.since, COVERAGE), null);
  assert.equal(windowAround(DAY + 1, COVERAGE), null);
});

test("a link's window is opened only once it is over", () => {
  const window = { start: DAY, end: DAY + HOUR };
  assert.equal(acceptsWindow(window, DAY + HOUR), true);
  assert.equal(acceptsWindow(window, DAY + HOUR - 1), false);
  assert.equal(acceptsWindow({ start: DAY + 1, end: DAY + HOUR }, DAY + 2 * HOUR), false);
});

test("the picker offers every day the archive keeps anything of", () => {
  const days = coverageDays({ since: DAY - 2 * 86_400 + 600, until: DAY + 3600 }, utcDay, nextUtcDay);
  assert.deepEqual(days, [DAY - 2 * 86_400, DAY - 86_400, DAY].map((s) => s * 1000));
});

test("a start may be any step of a whole day", () => {
  assert.deepEqual(startMinutes((DAY - 86_400) * 1000, COVERAGE, utcMinute, utcDay), [0, 1435]);
});

test("on the archive's first and last day a start is cut at its ends", () => {
  const coverage = { since: DAY - 86_400 + 7 * HOUR + 2 * 60, until: DAY + 9 * HOUR + 30 * 60 };
  assert.deepEqual(startMinutes((DAY - 86_400) * 1000, coverage, utcMinute, utcDay), [7 * 60 + 5, 1435]);
  assert.deepEqual(startMinutes(DAY * 1000, coverage, utcMinute, utcDay), [0, 9 * 60 + 30]);
});

test("a window's axis is labelled in clock times at both ends and on the clock between", () => {
  const steps = windowSteps({ start: DAY + 10 * 60, end: DAY + 3 * HOUR + 10 * 60 });
  const ticks = windowTicks(steps, 60, (t) => utcDay(t * 1000));
  assert.deepEqual(ticks.map((tick) => tick.t), [DAY + 10 * 60, DAY + HOUR, DAY + 2 * HOUR, DAY + 3 * HOUR + 10 * 60]);
  assert.equal(ticks[0].anchor, "start");
  assert.equal(ticks.at(-1)?.anchor, "end");
  assert.ok(ticks.every((tick) => !tick.withDate));
});

test("a label too close to an end gives way to the end's", () => {
  const steps = windowSteps({ start: DAY - 5 * 60, end: DAY + 3 * HOUR });
  const ticks = windowTicks(steps, 60, (t) => utcDay(t * 1000));
  assert.ok(!ticks.some((tick) => tick.t === DAY));
});

test("on a phone's strip a clock label gives way to the start's sooner", () => {
  // Three hours from 14:45: "15:00" is the fourth of 37 steps, 9.5% in.
  const steps = windowSteps({ start: DAY + 14 * HOUR + 45 * 60, end: DAY + 17 * HOUR + 45 * 60 });
  const every = (t: number) => utcDay(t * 1000);
  assert.ok(windowTicks(steps, 60, every, windowEdgeClear(1200, false)).some((tick) => tick.t === DAY + 15 * HOUR));
  assert.ok(!windowTicks(steps, 60, every, windowEdgeClear(360, false)).some((tick) => tick.t === DAY + 15 * HOUR));
  assert.ok(windowEdgeClear(360, true) > windowEdgeClear(360, false));
  assert.equal(windowEdgeClear(0, false), windowEdgeClear(10_000, false));
});

test("a window across midnight dates its first label and each new day's first", () => {
  const steps = windowSteps({ start: DAY - 3 * HOUR, end: DAY + 3 * HOUR });
  const ticks = windowTicks(steps, 60, (t) => utcDay(t * 1000));
  const dated = ticks.filter((tick) => tick.withDate).map((tick) => tick.t);
  assert.deepEqual(dated, [DAY - 3 * HOUR, DAY]);
});

test("an empty window has no labels", () => {
  assert.deepEqual(windowTicks([], 60, () => 0), []);
});

test("a long window is labelled less often, so the labels still fit", () => {
  assert.equal(windowLabelEvery(13, 30, 4), 30);
  assert.equal(windowLabelEvery(37, 30, 4), 60);
  assert.equal(windowLabelEvery(73, 30, 4), 120);
  assert.equal(windowLabelEvery(289, 30, 4), 360);
  assert.equal(windowLabelEvery(289, 60, 8), 180);
});

test("playback in a window steps on through it and round to its start from its end", () => {
  const window = { start: DAY, end: DAY + HOUR };
  assert.equal(nextWindowFrame(DAY, window), DAY + STEP_S);
  assert.equal(nextWindowFrame(DAY + HOUR - STEP_S, window), DAY + HOUR);
  assert.equal(nextWindowFrame(DAY + HOUR, window), DAY);
});

test("playback in a window wraps at the last step with a frame, and from outside it starts at its start", () => {
  const window = { start: DAY, end: DAY + HOUR };
  assert.equal(nextWindowFrame(DAY + HOUR - STEP_S, window, DAY + HOUR - STEP_S), DAY);
  assert.equal(nextWindowFrame(DAY - STEP_S, window), DAY);
});

test("strikes are asked for in three-hour pieces on the three-hour grid", () => {
  const base = DAY;
  assert.deepEqual(strikeChunks(base + HOUR, base + 4 * HOUR), [
    { since: base, until: base + STRIKE_CHUNK_S },
    { since: base + STRIKE_CHUNK_S, until: base + 2 * STRIKE_CHUNK_S },
  ]);
});

test("no piece of strikes runs past the cap, or starts at it", () => {
  assert.deepEqual(strikeChunks(DAY, DAY + 6 * HOUR, DAY + HOUR), [{ since: DAY, until: DAY + HOUR }]);
  assert.deepEqual(strikeChunks(DAY + 3 * HOUR, DAY + 6 * HOUR, DAY + 3 * HOUR), []);
});

test("a step needs the piece its half hour is in, and the one before across the grid", () => {
  assert.deepEqual(chunksFor(DAY + HOUR, DAY + 2 * HOUR), [{ since: DAY, until: DAY + 2 * HOUR }]);
  assert.deepEqual(chunksFor(DAY + 10 * 60, DAY + HOUR), [
    { since: DAY - STRIKE_CHUNK_S, until: DAY },
    { since: DAY, until: DAY + HOUR },
  ]);
});

test("a step draws the strikes of the half hour up to it, its own moment included", () => {
  const at = DAY + HOUR;
  const strike = (secondsBefore: number) => ({ lon: 0, lat: 0, time_wall: (at - secondsBefore) * 1000 });
  const strikes = [strike(31 * 60), strike(30 * 60), strike(29 * 60), strike(0), strike(-1)];
  assert.deepEqual(strikesAt(strikes, at).map((s) => s.time_wall), [strike(29 * 60), strike(0)].map((s) => s.time_wall));
});

test("a strike's age is counted from the step on screen, not the clock", () => {
  assert.equal(strikeAgeMinutes((DAY - 600) * 1000, DAY), 10);
  assert.equal(strikeAgeMinutes((DAY + 600) * 1000, DAY), 0);
});

test("a window hides what has no past and nothing else", () => {
  const window = { start: DAY, end: DAY + HOUR };
  for (const feature of NO_PAST) assert.equal(shownIn(window, feature), false, feature);
  for (const feature of ["radar", "lightning", "storms", "stations", "snow", "precipTypes"]) {
    assert.equal(shownIn(window, feature), true, feature);
  }
});

test("live shows everything", () => {
  for (const feature of NO_PAST) assert.equal(shownIn(null, feature), true, feature);
});

test("the 3D map is the one map a window cannot switch to", () => {
  const window = { start: DAY, end: DAY + HOUR };
  assert.equal(mapInWindow("cells3d", window), false);
  assert.equal(mapInWindow("radar", window), true);
  assert.equal(mapInWindow("lightning", window), true);
  assert.equal(mapInWindow("cells3d", null), true);
});

test("a window opens on the frame asked for when it has one", () => {
  const steps = windowSteps({ start: DAY, end: DAY + HOUR });
  assert.equal(frameInWindow(steps, () => true, DAY + 600, DAY + HOUR), DAY + 600);
});

test("a window asked for a missed scan opens on the frame before it", () => {
  const steps = windowSteps({ start: DAY, end: DAY + HOUR });
  assert.equal(frameInWindow(steps, (t) => t !== DAY + 600, DAY + 600, DAY + HOUR), DAY + 300);
});

test("a window with no frame up to the one asked for opens on its newest", () => {
  const steps = windowSteps({ start: DAY, end: DAY + HOUR });
  assert.equal(frameInWindow(steps, (t) => t > DAY + 900, DAY + 600, DAY + HOUR - STEP_S), DAY + HOUR - STEP_S);
});
