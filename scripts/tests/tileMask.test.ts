import assert from "node:assert/strict";
import test from "node:test";
import { bboxOf, overlaps, tileExtent } from "../../src/layers/tileMask.ts";

const LIMIT = 20037508.34;

test("tile 0/0/0 is the whole of web mercator", () => {
  assert.deepEqual(tileExtent(0, 0, 0), [-LIMIT, -LIMIT, LIMIT, LIMIT]);
});

test("XYZ rows count down from the north", () => {
  const [west, south, east, north] = tileExtent(1, 1, 1);
  assert.equal(west, 0);
  assert.equal(east, LIMIT);
  assert.equal(north, 0);
  assert.equal(south, -LIMIT);
});

test("a polygon's box is tight around every ring", () => {
  const rings = [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
    [[-5, 2], [-3, 2], [-3, 4]],
  ];
  assert.deepEqual(bboxOf(rings), [-5, 0, 10, 10]);
});

test("extents that share only an edge still overlap, and separated ones do not", () => {
  assert.equal(overlaps([0, 0, 1, 1], [1, 1, 2, 2]), true);
  assert.equal(overlaps([0, 0, 1, 1], [1.1, 0, 2, 1]), false);
  assert.equal(overlaps([0, 0, 1, 1], [0, 1.1, 1, 2]), false);
});
