import assert from "node:assert/strict";
import test from "node:test";
import { BLANK } from "../../src/lib/decodedTiles.ts";
import {
  PreviewStore, covers, cropBytes, cropExtent, cropFor, cropName, pieceCost, previewScale, previewZoom,
} from "../../src/lib/previewTiles.ts";
import type { PreviewPiece } from "../../src/lib/previewTiles.ts";

/**
 * The coarse previews of the timeline's frames: which zoom they come from,
 * which part of a tile a view needs, and what is kept of them.
 */

test("a view is previewed from three zooms up, or as far up as the pyramid goes", () => {
  assert.equal(previewZoom(8, 3), 5);
  assert.equal(previewZoom(5, 3), 3);
  assert.equal(previewZoom(4, 3), 3);
  assert.equal(previewZoom(3, 3), null, "at the top a preview would be the frame's own tiles");
});

test("a preview from nearer than three zooms up is thinned to the same resolution", () => {
  assert.equal(previewScale(8, 5), 1);
  assert.equal(previewScale(5, 3), 2);
  assert.equal(previewScale(4, 3), 4);
});

/** A tile of 512 pixels covering 0..512 both ways: a map unit a pixel, north at 512. */
const TILE = [0, 0, 512, 512];

test("the crop is every block the view touches and one around them, inside the tile", () => {
  // The view covers pixels 100..200 across and, counted from the north, 40..120 down.
  const crop = cropFor(TILE, 512, [100, 392, 200, 472]);
  assert.deepEqual(crop, { x: 64, y: 0, width: 192, height: 160 });
  assert.deepEqual(cropExtent(TILE, 512, crop!), [64, 352, 256, 512]);
});

test("a view past the tile's edge is cropped at the edge, and one that misses it has no crop", () => {
  // The tile's south-west corner: 40 pixels of it each way, and a block around them.
  assert.deepEqual(cropFor(TILE, 512, [-300, -300, 40, 40]), { x: 0, y: 416, width: 96, height: 96 });
  assert.equal(cropFor(TILE, 512, [600, 0, 700, 100]), null);
  assert.equal(cropFor(TILE, 512, [512, 0, 700, 100]), null, "touching is not meeting");
});

test("a view that moves within its blocks asks for the same crop", () => {
  const a = cropFor(TILE, 512, [100, 392, 200, 472])!;
  const b = cropFor(TILE, 512, [110, 400, 215, 478])!;
  assert.equal(cropName(a), cropName(b));
  assert.notEqual(cropName(a), cropName(a, 2));
});

test("a crop's bytes are its rows of the tile, a band or two a pixel", () => {
  const one = new Uint8Array(16).map((_, i) => i);
  assert.deepEqual([...cropBytes(one, 4, { x: 1, y: 2, width: 2, height: 2 })], [9, 10, 13, 14]);
  const two = new Uint8Array(32).map((_, i) => i);
  assert.deepEqual([...cropBytes(two, 4, { x: 1, y: 2, width: 2, height: 1 })], [18, 19, 20, 21]);
  assert.equal(cropBytes(one, 4, { x: 0, y: 0, width: 4, height: 4 }), one, "the whole tile is not copied");
});

test("a thinned crop keeps the strongest value of each block, and the coverage beside it", () => {
  const one = Uint8Array.from([
    1, 9, 0, 0,
    2, 3, 0, 7,
    0, 0, 5, 5,
    0, 0, 5, 6,
  ]);
  assert.deepEqual([...cropBytes(one, 4, { x: 0, y: 0, width: 4, height: 4 }, 2)], [9, 7, 0, 6]);
  const two = new Uint8Array(32);
  two.set([4, 200], 2); // pixel 1 of the first row: the strongest of its block, coverage 200
  two.set([3, 90], 8);
  assert.deepEqual([...cropBytes(two, 4, { x: 0, y: 0, width: 2, height: 2 }, 2)], [4, 200]);
});

test("ground lies within a piece's give or take a rounding", () => {
  assert.equal(covers([0, 0, 100, 100], [10, 10, 100.00001, 90]), true);
  assert.equal(covers([0, 0, 100, 100], [10, 10, 101, 90]), false);
});

function piece(key: string, frame: string, at: [number, number, number], ground: number[], bytes = 100): PreviewPiece {
  const [z, x, y] = at;
  return { key, frame, z, x, y, covers: ground, width: bytes, height: 1, tile: new Uint8Array(bytes) };
}

test("only the plan's pieces are taken in; an earlier plan's stay while there is room", () => {
  const store = new PreviewStore(10_000);
  assert.equal(store.put(piece("a", "f1", [3, 4, 2], TILE)), false, "not in any plan");
  store.plan(["a", "b"]);
  assert.equal(store.put(piece("a", "f1", [3, 4, 2], TILE)), true);
  assert.equal(store.put(piece("b", "f2", [3, 4, 2], TILE)), true);
  assert.equal(store.size, 2);
  // The map moved: the frame on screen may have only its old piece to be drawn from.
  store.plan(["b"]);
  assert.equal(store.find("f1", 3, 4, 2)?.key, "a");
  assert.equal(store.put(piece("a", "f1", [3, 4, 2], TILE)), false, "no longer taken in");
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.bytes, 0);
  assert.equal(store.put(piece("b", "f2", [3, 4, 2], TILE)), false, "nothing is taken in until the next plan");
});

test("the plan's pieces take the room of the earlier plans', the oldest first", () => {
  const each = pieceCost(100, 1, 1);
  const store = new PreviewStore(each * 2);
  store.plan(["old1", "old2"]);
  store.put(piece("old1", "f1", [3, 4, 2], TILE));
  store.put(piece("old2", "f2", [3, 4, 2], TILE));
  store.plan(["new1", "new2", "new3"]);
  assert.equal(store.put(piece("new1", "f3", [3, 4, 2], TILE)), true);
  assert.equal(store.has("old1"), false);
  assert.equal(store.has("old2"), true);
  assert.equal(store.put(piece("new2", "f4", [3, 4, 2], TILE)), true);
  assert.equal(store.has("old2"), false);
  assert.equal(store.put(piece("new3", "f5", [3, 4, 2], TILE)), false, "the plan's own are not pushed out");
  assert.equal(store.bytes, each * 2);
});

test("a blank costs next to nothing", () => {
  const store = new PreviewStore(pieceCost(100, 1, 1) + pieceCost(0, 0, 0));
  store.plan(["a", "b", "c"]);
  assert.equal(store.put(piece("a", "f1", [3, 4, 2], TILE)), true);
  assert.equal(store.put(piece("b", "f2", [3, 4, 2], TILE)), false);
  assert.equal(store.put({ ...piece("c", "f3", [3, 4, 2], TILE), tile: BLANK }), true);
});

test("a frame's piece is found from any tile under it whose ground it covers", () => {
  const store = new PreviewStore(10_000);
  store.plan(["a"]);
  // Coarse tile 3/4/2, cropped to its western half.
  store.put(piece("a", "f1", [3, 4, 2], [0, 0, 256, 512]));
  // Tile 6/32/16 is three zooms under 3/4/2.
  assert.equal(store.covering("f1", 6, 32, 16, [10, 10, 60, 60])?.key, "a");
  assert.equal(store.covering("f1", 6, 32, 16, [240, 10, 300, 60]), undefined, "past the crop");
  assert.equal(store.covering("f1", 6, 32, 16, [240, 10, 300, 60], true)?.key, "a", "part of it will do where asked");
  assert.equal(store.covering("f1", 6, 32, 16, [256, 10, 300, 60], true), undefined, "touching is not covering any");
  assert.equal(store.covering("f2", 6, 32, 16, [10, 10, 60, 60]), undefined, "another frame");
  assert.equal(store.covering("f1", 6, 40, 16, [10, 10, 60, 60]), undefined, "under another coarse tile");
});

test("a newer crop of a frame's coarse tile replaces the last, and those listening are told", () => {
  const store = new PreviewStore(10_000);
  const told: string[] = [];
  const stop = store.onPut(({ key }) => told.push(key));
  store.plan(["a", "a2"]);
  store.put(piece("a", "f1", [3, 4, 2], [0, 0, 256, 512]));
  store.put(piece("a2", "f1", [3, 4, 2], [128, 0, 384, 512]));
  assert.equal(store.has("a"), false);
  assert.equal(store.find("f1", 3, 4, 2)?.key, "a2");
  assert.equal(store.bytes, pieceCost(100, 1, 1));
  stop();
  store.put(piece("a", "f1", [3, 4, 2], [0, 0, 256, 512]));
  assert.deepEqual(told, ["a", "a2"]);
});
