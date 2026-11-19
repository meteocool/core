import assert from "node:assert/strict";
import test from "node:test";
import { ancestorCrop } from "../../src/layers/satellite.ts";
import { isDarkBasemap } from "../../src/layers/casing.ts";

test("a tile past the imagery is cut out of the right corner of its ancestor", () => {
  // z14 (8705, 5681) sits in z12 (2176, 1420), second column, second row of four.
  assert.deepEqual(ancestorCrop(14, 8705, 5681, 2), { z: 12, x: 2176, y: 1420, sx: 128, sy: 128, size: 128 });
  assert.deepEqual(ancestorCrop(13, 4352, 2841, 1), { z: 12, x: 2176, y: 1420, sx: 0, sy: 256, size: 256 });
});

test("labels, casings and chrome treat the imagery as a dark basemap", () => {
  assert.equal(isDarkBasemap("satellite"), true);
  assert.equal(isDarkBasemap("light"), false);
});
