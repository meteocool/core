import assert from "node:assert/strict";
import test from "node:test";
import { packPixels } from "../../src/lib/packPixels.ts";

/** RGBA pixels the way a decoded value tile reads back: R = G = B = the value. */
const tile = (...pixels: [value: number, alpha: number][]) =>
  new Uint8ClampedArray(pixels.flatMap(([value, alpha]) => [value, value, value, alpha]));

test("an opaque tile packs to its values, one byte a pixel", () => {
  assert.deepEqual(packPixels(tile([12, 255], [200, 255], [0, 255])), new Uint8Array([12, 200, 0]));
});

test("a transparent pixel packs as 0, which every value palette draws as nothing", () => {
  // Whatever its colour bytes say: transparency is what it means.
  assert.deepEqual(packPixels(tile([90, 255], [37, 0])), new Uint8Array([90, 0]));
});

test("a tile with partial coverage keeps its alpha, as a second byte a pixel", () => {
  assert.deepEqual(
    packPixels(tile([90, 255], [37, 128], [5, 0])),
    new Uint8Array([90, 255, 37, 128, 5, 0]),
  );
});
