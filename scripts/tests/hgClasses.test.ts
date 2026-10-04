import assert from "node:assert/strict";
import test from "node:test";
import { HG_CLASS_COLOURS, hgClassStyle } from "../../src/lib/hgClasses.ts";

test("byte 0 draws nothing and every class is opaque and its own colour", () => {
  assert.deepEqual(HG_CLASS_COLOURS[0], [0, 0, 0, 0]);
  const classes = HG_CLASS_COLOURS.slice(1);
  assert.equal(classes.length, 7);
  for (const [, , , a] of classes) assert.equal(a, 255);
  assert.equal(new Set(classes.map((c) => c.join())).size, classes.length);
});

test("hail and graupel, the bytes the backend gives them, are red and orange", () => {
  // meteocool/ng worker-radar `HG_CLASS_BYTES`: 8192 -> 7, 4096 -> 6.
  assert.deepEqual(HG_CLASS_COLOURS[7], [255, 0, 0, 255]);
  assert.deepEqual(HG_CLASS_COLOURS[6], [255, 0x99, 0, 255]);
});

test("the style looks up every byte, and a byte past the last class draws nothing", () => {
  const [op, index, colours] = hgClassStyle().color as [string, unknown, number[][]];
  assert.equal(op, "palette");
  assert.deepEqual(index, ["*", ["band", 1], 255]);
  assert.equal(colours.length, 256);
  assert.deepEqual(colours[3], [0, 0, 255, 1]);
  assert.deepEqual(colours[8], [0, 0, 0, 0]);
  assert.deepEqual(colours[255], [0, 0, 0, 0]);
});
