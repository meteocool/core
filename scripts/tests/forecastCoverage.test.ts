import assert from "node:assert/strict";
import test from "node:test";
import { uncoveredShare } from "../../src/lib/forecastCoverage.ts";

/**
 * The share of the screen a forecast step has nothing for, which decides
 * whether the player says "no forecast here".
 */

const eastOf = (edge: number) => (lon: number) => lon >= edge;

test("a screen inside the coverage has nothing uncovered", () => {
  assert.equal(uncoveredShare([8, 48, 12, 52], () => true), 0);
});

test("a screen outside it is all uncovered", () => {
  assert.equal(uncoveredShare([-5, 40, 0, 45], () => false), 1);
});

test("a screen split down the middle is half uncovered", () => {
  assert.equal(uncoveredShare([0, 45, 10, 50], eastOf(5)), 0.5);
});

test("samples are spread as the screen shows them, not in degrees", () => {
  // Covered north of 60°: a third of the degrees, but 38% of the screen,
  // which Web Mercator stretches towards the pole.
  const share = uncoveredShare([0, 50, 10, 65], (_lon, lat) => lat >= 60, 48);
  assert.ok(Math.abs(share - 0.618) < 0.02, `uncovered ${share}`);
});
