import assert from "node:assert/strict";
import test from "node:test";
import { insideRings, networkAt } from "../../src/layers/networkAt.ts";

test("each network owns its own country", () => {
  assert.equal(networkAt(46.95, 7.45), "ch"); // Bern
  assert.equal(networkAt(48.86, 2.35), "fr"); // Paris
  assert.equal(networkAt(44.84, -0.58), "fr"); // Bordeaux, off DWD's grid
  assert.equal(networkAt(50.08, 14.43), "cz"); // Prague
  assert.equal(networkAt(52.23, 21.01), "pl"); // Warsaw
});

test("DWD's ground and ground nobody covers are no network's", () => {
  assert.equal(networkAt(48.14, 11.58), undefined); // Munich
  assert.equal(networkAt(52.52, 13.40), undefined); // Berlin
  assert.equal(networkAt(40.42, -3.70), undefined); // Madrid
});

test("a ring wound the other way is a hole, under the nonzero rule", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[4, 4], [4, 6], [6, 6], [6, 4]];
  assert.equal(insideRings([outer, hole], [2, 2]), true);
  assert.equal(insideRings([outer, hole], [5, 5]), false);
  assert.equal(insideRings([outer, hole], [12, 5]), false);
});
