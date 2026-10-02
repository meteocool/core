import assert from "node:assert/strict";
import test from "node:test";
import { envelope, rainIn, rainWithin, stepAt } from "../../src/lib/compare/outlook.ts";
import type { HourlySeries } from "../../src/lib/compare/openMeteo.ts";

/**
 * The dry-weather strip picks its range from these: the week, unless the
 * models see rain inside a day. Wrong, it shows a flat week over tomorrow's
 * rain, or a day of nothing over a dry week.
 */

const HOUR = 3_600_000;
const t0 = Date.UTC(2026, 8, 27, 0);

/** Hourly series from midnight, one row of hourly rainfall (mm) per model. */
function series(rows: Record<string, Array<number | null>>): HourlySeries {
  const length = Math.max(...Object.values(rows).map((r) => r.length));
  return { times: Array.from({ length }, (_u, i) => t0 + i * HOUR), series: rows, units: "mm" };
}

test("the present is the hour now falls in, not midnight", () => {
  const { times } = series({ a: new Array(48).fill(0) });
  assert.equal(stepAt(times, t0 + 9.5 * HOUR), 9);
  assert.equal(stepAt(times, t0 - HOUR), 0);
  assert.equal(stepAt(times, t0 + 100 * HOUR), 47);
  assert.equal(stepAt([], t0), 0);
});

test("the envelope is min, median and max across the models that answered", () => {
  const env = envelope(series({ a: [10, null], b: [30, null], c: [20, 5] }), 0, 2);
  assert.deepEqual(env.min, [10, 5]);
  assert.deepEqual(env.mid, [20, 5]);
  assert.deepEqual(env.max, [30, 5]);
  assert.deepEqual(env.count, [3, 1]);
});

test("rain the median reaches inside the window counts", () => {
  const wet = new Array(48).fill(0);
  wet[20] = 1.5;
  const s = series({ a: wet, b: wet, c: new Array(48).fill(0) });
  assert.equal(rainWithin(s, 0, 24), true);
  // Past the window it is the week's business, not the day's.
  assert.equal(rainWithin(s, 0, 20), false);
  // And behind `from` it is over.
  assert.equal(rainWithin(s, 21, 24), false);
});

test("one wet model among dry ones is disagreement, not rain", () => {
  const wet = new Array(24).fill(4);
  const dry = new Array(24).fill(0);
  assert.equal(rainWithin(series({ a: wet, b: dry, c: dry }), 0, 24), false);
});

test("the strip says how far off the rain is: the first hour the median reaches it", () => {
  const wet = new Array(168).fill(0);
  wet[5] = 0.3;
  wet[30] = 2;
  const s = series({ a: wet, b: wet, c: new Array(168).fill(0) });
  assert.equal(rainIn(s, 0, 168), 5);
  // Counted from the present, not from the series' midnight.
  assert.equal(rainIn(s, 3, 168), 2);
  assert.equal(rainIn(s, 6, 168), 24);
  // Already raining by the models' reckoning: within the hour.
  assert.equal(rainIn(s, 5, 168), 0);
});

test("a week the median never reaches has no rain to count down to", () => {
  const drizzle = new Array(168).fill(0.1);
  assert.equal(rainIn(series({ a: drizzle, b: drizzle }), 0, 168), null);
  // Nor does one wet model among dry ones.
  assert.equal(rainIn(series({ a: new Array(168).fill(4), b: drizzle, c: drizzle }), 0, 168), null);
});
