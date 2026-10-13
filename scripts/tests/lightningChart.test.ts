import assert from "node:assert/strict";
import test from "node:test";
import { yTickLabel } from "../../src/lib/lightningChart.ts";

/**
 * The lightning histogram's y axis: labelled at its ends, the foot with 0
 * and the top with the busiest minute, wherever Chart.js lists them.
 */
test("the top of the axis reads the busiest minute", () => {
  assert.equal(yTickLabel(224, 224), "224");
});

test("the foot of the axis reads 0, not the quietest minute", () => {
  assert.equal(yTickLabel(0, 224), "0");
});

test("the ticks in between go unlabelled", () => {
  assert.equal(yTickLabel(100, 224), "");
  assert.equal(yTickLabel(200, 224), "");
});
