import assert from "node:assert/strict";
import test from "node:test";
import { drawsNothing, magnifyValues, packValues } from "../../src/lib/packPixels.ts";

test("an uncut tile packs to its values, one byte a pixel", () => {
  assert.deepEqual(packValues(new Uint8Array([12, 200, 0]), null), new Uint8Array([12, 200, 0]));
});

test("a pixel cut away packs as 0, which every value palette draws as nothing", () => {
  // Whatever its value: being cut away is what it means.
  assert.deepEqual(packValues(new Uint8Array([90, 37]), new Uint8Array([255, 0])), new Uint8Array([90, 0]));
});

test("a tile with partial coverage keeps it, as a second byte a pixel", () => {
  assert.deepEqual(
    packValues(new Uint8Array([90, 37, 5]), new Uint8Array([255, 128, 0])),
    new Uint8Array([90, 255, 37, 128, 5, 0]),
  );
});

test("a tile past the frame's depth is its part of the ancestor, each pixel a square of its own value", () => {
  // A 4 px tile, its bottom-right quarter magnified twice.
  const ancestor = new Uint8Array([
    1, 2, 3, 4,
    5, 6, 7, 8,
    9, 10, 11, 12,
    13, 14, 15, 16,
  ]);
  assert.deepEqual(magnifyValues(ancestor, 4, { scale: 2, column: 1, row: 1 }), new Uint8Array([
    11, 11, 12, 12,
    11, 11, 12, 12,
    15, 15, 16, 16,
    15, 15, 16, 16,
  ]));
  assert.equal(magnifyValues(ancestor, 4, { scale: 1, column: 0, row: 0 }), ancestor);
});

test("a tile of zeros draws nothing, and one value anywhere does", () => {
  assert.equal(drawsNothing(new Uint8Array(512 * 512), 512 * 512), true);
  for (const at of [0, 1, 4097, 512 * 512 - 1]) {
    const tile = new Uint8Array(512 * 512);
    tile[at] = 1;
    assert.equal(drawsNothing(tile, 512 * 512), false, `a value at ${at}`);
  }
  // A view that does not start on a word, and an odd length.
  const odd = new Uint8Array(new ArrayBuffer(16), 1, 13);
  assert.equal(drawsNothing(odd, 13), true);
  odd[12] = 3;
  assert.equal(drawsNothing(odd, 13), false);
});

test("a cut tile with coverage left but no value draws nothing; one value does", () => {
  // Value, coverage: the antialiased edge of a hole over ground with no echo.
  assert.equal(drawsNothing(new Uint8Array([0, 255, 0, 128, 0, 0]), 3), true);
  assert.equal(drawsNothing(new Uint8Array([0, 255, 7, 128, 0, 0]), 3), false);
});
