import assert from "node:assert/strict";
import test from "node:test";
import {
  axisTicks, barCeiling, flickGlides, forecastGapFrom, glideStep, hasEcho, indexOf, lastPlayableIndex,
  lastPublishedStep, newestObservation, reachOf, restingStep, rubberBand, stepOver, sweepGaps, timelineSteps,
} from "../../src/lib/timeline.ts";
import type { GridConfig } from "../../src/caps/RadarCapability.ts";

/**
 * The playback timeline's arithmetic: which steps the strip holds, where its
 * labels fall, and how a flicked needle comes to rest. The component only
 * draws what these say.
 */

const NOW = 1_700_000_000;
/** Every step from the first to `last`, as the strip with no radar open. */
const upTo = (last: number) => ({ first: 0, last, gaps: new Set<number>() });
const STEP = 300;

function grid(from: number, to: number, dbz: (t: number) => number | null): GridConfig {
  const out: GridConfig["grid"] = {};
  for (let t = from; t <= to; t += STEP) {
    const value = dbz(t);
    out[t] = {
      dbz: value as number,
      url: "x",
      tile_id: "x",
      source: t <= NOW ? "observation" : "nowcast",
    };
  }
  return { grid: out, start: from, end: to, now: NOW, length: Object.keys(out).length };
}

test("steps are sorted, span the whole grid, mark the unpublished tail, and floor at zero", () => {
  const config = grid(NOW - 2 * STEP, NOW + 3 * STEP, (t) => (t === NOW ? -5 : 10));
  const steps = timelineSteps(config, NOW + STEP);
  assert.deepEqual(steps.map((s) => s.t), [NOW - 2 * STEP, NOW - STEP, NOW, NOW + STEP, NOW + 2 * STEP, NOW + 3 * STEP]);
  assert.equal(steps[2].dbz, 0);
  assert.equal(steps[2].forecast, false);
  assert.equal(steps[3].forecast, true);
  assert.deepEqual(steps.map((s) => s.playable), [true, true, true, true, false, false]);
  assert.equal(lastPlayableIndex(steps), 3);
});

test("the axis ends at +2h even when the last frames are not published yet", () => {
  const config = grid(NOW - 24 * STEP, NOW + 24 * STEP, () => 0);
  const steps = timelineSteps(config, NOW + 21 * STEP);
  const ticks = axisTicks(steps, NOW, 60);
  assert.equal(ticks.at(-1)?.minutes, 120);
  assert.equal(lastPlayableIndex(steps), 45);
});

test("a grid with no readings has no echo and a flat ceiling", () => {
  const steps = timelineSteps(grid(NOW - STEP, NOW + STEP, () => null), NOW + STEP);
  assert.equal(hasEcho(steps), false);
  assert.equal(barCeiling(steps), 45);
  assert.equal(steps[0].dbz, null);
});

test("the ceiling rises with hail so nothing clips", () => {
  const steps = timelineSteps(grid(NOW - STEP, NOW + STEP, () => 61.4), NOW + STEP);
  assert.equal(barCeiling(steps), 62);
});

test("a past with readings and a forecast with none marks where the forecast would start", () => {
  const steps = timelineSteps(grid(NOW - 3 * STEP, NOW + 4 * STEP, (t) => (t <= NOW ? 20 : null)), NOW + 4 * STEP);
  assert.equal(forecastGapFrom(steps), 4 / 8);
  // An unpublished tail is not a missing forecast.
  const wet = timelineSteps(grid(NOW - 3 * STEP, NOW + 4 * STEP, (t) => (t <= NOW + 2 * STEP ? 20 : null)), NOW + 2 * STEP);
  assert.equal(forecastGapFrom(wet), null);
});

test("no gap is reported when the forecast has readings, or when nothing does", () => {
  assert.equal(forecastGapFrom(timelineSteps(grid(NOW - STEP, NOW + STEP, () => 20), NOW + STEP)), null);
  assert.equal(forecastGapFrom(timelineSteps(grid(NOW - STEP, NOW + STEP, () => null), NOW + STEP)), null);
});

test("a forecast that ends before the published strip does is marked from where it ends", () => {
  // Readings to +2 steps, the last lead of a run still being made, and the published forecast on to +4.
  const short = timelineSteps(grid(NOW - 3 * STEP, NOW + 4 * STEP, (t) => (t <= NOW + 2 * STEP ? 20 : null)), NOW + 4 * STEP);
  assert.equal(forecastGapFrom(short), 6 / 8);
  // A step missing in the middle of a run is not its end.
  const holed = timelineSteps(grid(NOW - STEP, NOW + 3 * STEP, (t) => (t === NOW + STEP ? null : 20)), NOW + 3 * STEP);
  assert.equal(forecastGapFrom(holed), null);
});

test("the axis labels both ends and the round offsets between, clear of the ends", () => {
  const config = grid(NOW - 24 * STEP, NOW + 23 * STEP, () => 0);
  const steps = timelineSteps(config, NOW + 23 * STEP);
  const ticks = axisTicks(steps, NOW, 60);
  assert.equal(ticks[0].anchor, "start");
  assert.equal(ticks[0].minutes, -120);
  assert.equal(ticks.at(-1)?.anchor, "end");
  assert.equal(ticks.at(-1)?.minutes, 115);
  assert.deepEqual(ticks.slice(1, -1).map((t) => t.minutes), [-60, 0, 60]);
});

test("indexOf finds the step at or before a time, clamped", () => {
  const steps = timelineSteps(grid(NOW - STEP, NOW + STEP, () => 0), NOW + STEP);
  assert.equal(indexOf(steps, NOW), 1);
  assert.equal(indexOf(steps, NOW + 100), 1);
  assert.equal(indexOf(steps, NOW - 10 * STEP), 0);
  assert.equal(indexOf(steps, NOW + 10 * STEP), 2);
});

test("the ends give way a little and never more than the overshoot", () => {
  assert.equal(rubberBand(5, upTo(10)), 5);
  assert.ok(rubberBand(-3, upTo(10)) < 0 && rubberBand(-3, upTo(10)) > -1.5);
  assert.ok(rubberBand(100, upTo(10)) > 10 && rubberBand(100, upTo(10)) < 11.5);
});

test("a glide slows, stops dead at an end, and rests on a whole step", () => {
  let needle = { pos: 2, velocity: 0.05 };
  needle = glideStep(needle, 16, upTo(10));
  assert.ok(needle.pos > 2);
  assert.ok(needle.velocity < 0.05);
  const hit = glideStep({ pos: 9.9, velocity: 0.05 }, 16, upTo(10));
  assert.equal(hit.pos, 10);
  assert.equal(hit.velocity, 0);
  assert.equal(restingStep(3.4, upTo(10)), 3);
  assert.equal(restingStep(-0.8, upTo(10)), 0);
  assert.equal(restingStep(12, upTo(10)), 10);
});

test("a needle let go near now is caught by it; one further away is not", () => {
  assert.equal(restingStep(24.8, upTo(47), 24), 24);
  assert.equal(restingStep(23.2, upTo(47), 24), 24);
  assert.equal(restingStep(22.9, upTo(47), 24), 23);
  assert.equal(restingStep(30.4, upTo(47), 24), 30);
});

test("a slow glide is caught crossing now; a fast one passes through", () => {
  const slow = glideStep({ pos: 23.95, velocity: 0.005 }, 16, upTo(47), 24);
  assert.equal(slow.pos, 24);
  assert.equal(slow.velocity, 0);
  const fast = glideStep({ pos: 23.95, velocity: 0.08 }, 16, upTo(47), 24);
  assert.ok(fast.pos > 24);
  assert.ok(fast.velocity > 0);
  // Not crossing it: nothing to catch.
  const away = glideStep({ pos: 30, velocity: 0.005 }, 16, upTo(47), 24);
  assert.ok(away.pos > 30 && away.velocity > 0);
});

/** Observations to NOW, a nowcast published to `published`, unpublished to +2h, `holes` missed. */
function published(holes: number[], publishedTo = NOW + 6 * STEP): GridConfig["grid"] {
  const out: GridConfig["grid"] = {};
  for (let t = NOW - 6 * STEP; t <= NOW + 24 * STEP; t += STEP) {
    const missing = holes.includes(t) || t > publishedTo;
    out[t] = {
      dbz: 0,
      url: missing ? null : "x",
      tile_id: missing ? "" : "x",
      source: t <= NOW ? "observation" : "nowcast_phys",
    };
  }
  return out;
}

test("a missed scan does not pin now to the frame before it", () => {
  const grid = published([NOW - 3 * STEP]);
  assert.equal(newestObservation(grid, NOW), NOW);
  assert.equal(lastPublishedStep(grid, 0), NOW + 6 * STEP);
});

test("the unpublished nowcast tail still ends what can be played", () => {
  assert.equal(lastPublishedStep(published([], NOW + 2 * STEP), 0), NOW + 2 * STEP);
  assert.equal(lastPublishedStep(published([NOW + 2 * STEP], NOW + 2 * STEP), 0), NOW + STEP);
});

test("with no observation, now is the newest frame at or before the clock, then the clock", () => {
  const forecastOnly: GridConfig["grid"] = {
    [NOW - STEP]: { dbz: 0, url: "x", tile_id: "x", source: "nowcast_phys" },
    [NOW]: { dbz: 0, url: null, tile_id: "", source: "nowcast_phys" },
    [NOW + STEP]: { dbz: 0, url: "x", tile_id: "x", source: "nowcast_phys" },
  };
  assert.equal(newestObservation(forecastOnly, NOW), NOW - STEP);
  assert.equal(newestObservation({}, NOW), NOW);
  assert.equal(newestObservation(null, NOW), NOW);
  assert.equal(lastPublishedStep(null, 42), 42);
});

test("a thumb's flick carries the needle on", () => {
  assert.equal(flickGlides("touch"), true);
});

test("a mouse, trackpad or pen stops where it is let go", () => {
  assert.equal(flickGlides("mouse"), false);
  assert.equal(flickGlides("pen"), false);
});

/** Six steps: no sweep on 0, 3 and 5 (a gap, and the forecast past it). */
const sweptSteps = [false, true, true, false, true, false].map((swept, i) => ({
  t: NOW + i * STEP, dbz: null, forecast: i === 5, playable: true, noSweep: !swept,
}));

test("with a radar open the needle reaches from its first sweep to its last, around the gaps", () => {
  const reach = reachOf(sweptSteps);
  assert.deepEqual({ ...reach, gaps: [...reach.gaps] }, { first: 1, last: 4, gaps: [3] });
  assert.deepEqual(sweepGaps(sweptSteps), [[0, 0], [3, 3], [5, 5]]);
  // Without one, every published step.
  assert.deepEqual(reachOf(sweptSteps.map((step) => ({ ...step, noSweep: undefined }))).first, 0);
});

test("a needle let go in a gap rests on its nearer side, and never past the sweeps", () => {
  const reach = reachOf(sweptSteps);
  assert.equal(restingStep(2.9, reach), 2);
  assert.equal(restingStep(3.4, reach), 4);
  assert.equal(restingStep(0.2, reach), 1);
  assert.equal(restingStep(5.3, reach), 4);
  // Now in a gap does not catch it.
  assert.equal(restingStep(3.2, reach, 3), 4);
  assert.ok(rubberBand(-1, reach) < 1 && rubberBand(-1, reach) > -0.5);
  assert.equal(glideStep({ pos: 1.05, velocity: -0.05 }, 16, reach).pos, 1);
});

test("the arrow keys step over a gap the way they go", () => {
  const reach = reachOf(sweptSteps);
  assert.equal(stepOver(2, 1, reach), 4);
  assert.equal(stepOver(4, -1, reach), 2);
  assert.equal(stepOver(4, 6, reach), 4);
  assert.equal(stepOver(1, -6, reach), 1);
});
