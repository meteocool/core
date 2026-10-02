import assert from "node:assert/strict";
import test from "node:test";
import { deepestZoom, hasTile, sourceTile } from "../../src/lib/tileIndex.ts";

/**
 * The same example the encoder's test in meteocool/ng uses: zoom 5 is a 2x2
 * rectangle from (16, 20) with its top-left and bottom-right set (1001, so
 * the byte 0x90), zoom 4 one tile at (8, 10).
 */
const index = {
  "4": { x: 8, y: 10, w: 1, h: 1, bits: "gA==" },
  "5": { x: 16, y: 20, w: 2, h: 2, bits: "kA==" },
};

test("a listed tile is present and an unlisted one is absent", () => {
  assert.equal(hasTile(index, 5, 16, 20), true);
  assert.equal(hasTile(index, 5, 17, 21), true);
  assert.equal(hasTile(index, 5, 17, 20), false);
  assert.equal(hasTile(index, 5, 16, 21), false);
  assert.equal(hasTile(index, 4, 8, 10), true);
});

test("outside the rectangle there is nothing", () => {
  assert.equal(hasTile(index, 5, 15, 20), false);
  assert.equal(hasTile(index, 5, 18, 20), false);
  assert.equal(hasTile(index, 5, 16, 19), false);
  assert.equal(hasTile(index, 5, 16, 22), false);
});

test("a zoom the index does not mention, or no index at all, is asked for", () => {
  // The only way to know is to ask: a frame from before the index existed
  // must load exactly as it always did.
  assert.equal(hasTile(index, 6, 33, 42), true);
  assert.equal(hasTile(null, 5, 17, 20), true);
  assert.equal(hasTile(undefined, 5, 17, 20), true);
});

test("bits are read row major, most significant first, across byte boundaries", () => {
  // 3 wide, 3 tall: 9 bits, with only the last set -> 0x00 0x80.
  const wide = { "3": { x: 0, y: 0, w: 3, h: 3, bits: "AIA=" } };
  assert.equal(hasTile(wide, 3, 2, 2), true);
  assert.equal(hasTile(wide, 3, 1, 2), false);
  assert.equal(hasTile(wide, 3, 0, 0), false);
});

test("a frame goes as deep as its index does", () => {
  // The observation is tiled to 9, a forecast step to 8; an older frame says nothing.
  assert.equal(deepestZoom(index), 5);
  assert.equal(deepestZoom({ ...index, "9": index["5"] }), 9);
  assert.equal(deepestZoom(null), undefined);
  assert.equal(deepestZoom({}), undefined);
});

test("within a frame's depth a tile comes from itself", () => {
  assert.deepEqual(sourceTile(index, 5, 16, 11), { z: 5, x: 16, y: 11, scale: 1, column: 0, row: 0 });
  assert.deepEqual(sourceTile(null, 9, 271, 170), { z: 9, x: 271, y: 170, scale: 1, column: 0, row: 0 });
});

test("past it, from the part of its ancestor that covers it", () => {
  // A forecast step tiled to 8, asked for zoom 9: each z8 tile is two by two z9s.
  const forecast = { "8": { x: 130, y: 80, w: 10, h: 10, bits: "" } };
  assert.deepEqual(sourceTile(forecast, 9, 271, 170), { z: 8, x: 135, y: 85, scale: 2, column: 1, row: 0 });
  assert.deepEqual(sourceTile(forecast, 9, 270, 171), { z: 8, x: 135, y: 85, scale: 2, column: 0, row: 1 });
  // Two levels past, four by four.
  assert.deepEqual(sourceTile(forecast, 10, 543, 343), { z: 8, x: 135, y: 85, scale: 4, column: 3, row: 3 });
});
