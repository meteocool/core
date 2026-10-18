import assert from "node:assert/strict";
import test from "node:test";
import { idleLayers, MIN_LAYER_TILES, tileShare } from "../../src/lib/idleLayers.ts";

test("a layer drawn within the wait is not idle", () => {
  assert.deepEqual(idleLayers(new Map([["dwd", 10_000]]), 25_000, 20_000), []);
});

test("a layer the map has not drawn for longer than the wait is idle", () => {
  const lastDrawn = new Map([["dwd", 30_000], ["ch", 9_000], ["nowcast-at", 1_000]]);
  assert.deepEqual(idleLayers(lastDrawn, 30_000, 20_000), ["ch", "nowcast-at"]);
});

test("the layers drawn split the budget evenly", () => {
  assert.equal(tileShare(320, 4, 128), 80);
});

test("a layer keeps room for twice the frame it shows, beyond its share", () => {
  assert.equal(tileShare(320, 26, 128, 15), 30);
});

test("a layer showing little keeps a few tiles still", () => {
  assert.equal(tileShare(320, 80, 128, 1), MIN_LAYER_TILES);
});

test("a share never grows a layer past its own cache", () => {
  assert.equal(tileShare(320, 1, 128), 128);
});

test("a budget with no layers drawn yet is one layer's", () => {
  assert.equal(tileShare(320, 0, 512), 320);
});
