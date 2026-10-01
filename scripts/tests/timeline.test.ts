import assert from "node:assert/strict";
import test from "node:test";
import {
  axisTicks, barCeiling, forecastGapFrom, glideStep, hasEcho, indexOf, restingStep, rubberBand,
  timelineSteps,
} from "../../src/lib/timeline.ts";
import type { GridConfig } from "../../src/caps/RadarCapability.ts";

/**
 * The playback timeline's arithmetic: which steps the strip holds, where its
 * labels fall, and how a flicked needle comes to rest. The component only
 * draws what these say.
 */

const NOW = 1_700_000_000;
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

test("steps are sorted, cut at the last playable step, and floored at zero", () => {
  const config = grid(NOW - 2 * STEP, NOW + 3 * STEP, (t) => (t === NOW ? -5 : 10));
  const steps = timelineSteps(config, NOW + STEP);
  assert.deepEqual(steps.map((s) => s.t), [NOW - 2 * STEP, NOW - STEP, NOW, NOW + STEP]);
  assert.equal(steps[2].dbz, 0);
  assert.equal(steps[2].forecast, false);
  assert.equal(steps[3].forecast, true);
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
});

test("no gap is reported when the forecast has readings, or when nothing does", () => {
  assert.equal(forecastGapFrom(timelineSteps(grid(NOW - STEP, NOW + STEP, () => 20), NOW + STEP)), null);
  assert.equal(forecastGapFrom(timelineSteps(grid(NOW - STEP, NOW + STEP, () => null), NOW + STEP)), null);
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
  assert.equal(rubberBand(5, 10), 5);
  assert.ok(rubberBand(-3, 10) < 0 && rubberBand(-3, 10) > -1.5);
  assert.ok(rubberBand(100, 10) > 10 && rubberBand(100, 10) < 11.5);
});

test("a glide slows, stops dead at an end, and rests on a whole step", () => {
  let needle = { pos: 2, velocity: 0.05 };
  needle = glideStep(needle, 16, 10);
  assert.ok(needle.pos > 2);
  assert.ok(needle.velocity < 0.05);
  const hit = glideStep({ pos: 9.9, velocity: 0.05 }, 16, 10);
  assert.equal(hit.pos, 10);
  assert.equal(hit.velocity, 0);
  assert.equal(restingStep(3.4, 10), 3);
  assert.equal(restingStep(-0.8, 10), 0);
  assert.equal(restingStep(12, 10), 10);
});

test("a needle let go near now is caught by it; one further away is not", () => {
  assert.equal(restingStep(24.8, 47, 24), 24);
  assert.equal(restingStep(23.2, 47, 24), 24);
  assert.equal(restingStep(22.9, 47, 24), 23);
  assert.equal(restingStep(30.4, 47, 24), 30);
});

test("a slow glide is caught crossing now; a fast one passes through", () => {
  const slow = glideStep({ pos: 23.95, velocity: 0.005 }, 16, 47, 24);
  assert.equal(slow.pos, 24);
  assert.equal(slow.velocity, 0);
  const fast = glideStep({ pos: 23.95, velocity: 0.08 }, 16, 47, 24);
  assert.ok(fast.pos > 24);
  assert.ok(fast.velocity > 0);
  // Not crossing it: nothing to catch.
  const away = glideStep({ pos: 30, velocity: 0.005 }, 16, 47, 24);
  assert.ok(away.pos > 30 && away.velocity > 0);
});
