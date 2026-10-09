import assert from "node:assert/strict";
import test from "node:test";
import { drapeAnchor, mapPixelRatio, radarTileCache } from "../../src/lib/gpuBudget.ts";

test("a phone's 3x is drawn at 2x, a desktop's ratio as it is", () => {
  assert.equal(mapPixelRatio(3, true), 2);
  assert.equal(mapPixelRatio(1.5, true), 1.5);
  assert.equal(mapPixelRatio(3, false), 3);
});

test("a phone asked for full resolution draws at its own ratio", () => {
  assert.equal(mapPixelRatio(3, true, true), 3);
  assert.equal(mapPixelRatio(3, true, false), 2);
});

test("a layer on the ground goes before the first layer that stands up", () => {
  const layers = [
    { id: "background", type: "background" },
    { id: "hillshade", type: "hillshade" },
    { id: "radar", type: "raster" },
    { id: "cell-footprint", type: "line" },
    { id: "cell-volume-0", type: "fill-extrusion" },
    { id: "cell-volume-raymarched", type: "custom" },
    { id: "place-labels", type: "symbol" },
  ];
  assert.equal(drapeAnchor(layers), "cell-volume-0");
  // Before the storms are in, the first thing standing is whatever comes next.
  assert.equal(drapeAnchor(layers.filter((layer) => layer.type !== "fill-extrusion")), "cell-volume-raymarched");
  assert.equal(drapeAnchor(layers.slice(0, 4)), undefined);
});

test("a phone's radar layers keep a quarter of a desktop's tiles, never more than asked", () => {
  assert.equal(radarTileCache(512, true), 128);
  assert.equal(radarTileCache(64, true), 64);
  assert.equal(radarTileCache(512, false), 512);
});
