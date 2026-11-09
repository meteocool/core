import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_RADAR_TILE_CACHE, HANDHELD_RADAR_TILES, HANDHELD_RADAR_TILE_CACHE, RADAR_TILE_BYTES, decodeAheadParallel, decodeWorkers,
  decodedTileBytes,
  drapeAnchor, frameTextureBytes, mapPixelRatio, radarTileCache, tileBytes, uploadAheadSteps, uploadsPerFrame,
} from "../../src/lib/gpuBudget.ts";

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

test("a phone's radar layers keep a fifth of a desktop's tiles, never more than asked", () => {
  assert.equal(radarTileCache(512, true), 128);
  assert.equal(radarTileCache(64, true), 64);
  assert.equal(radarTileCache(512, false), 512);
  assert.equal(radarTileCache(undefined, true), 128);
  assert.equal(radarTileCache(undefined, false), DESKTOP_RADAR_TILE_CACHE);
});

test("a radar tile is a byte a pixel and band, 512 pixels square", () => {
  assert.equal(RADAR_TILE_BYTES, 512 * 512);
  assert.equal(tileBytes(2), 2 * 512 * 512, "the antialiased edge of a network's ground keeps its coverage too");
});

test("the tile counts come out of byte budgets that keep October's ceilings on a phone", () => {
  // 32 MB a layer, 80 MB between the layers drawn: what the memory measures were taken at.
  assert.equal(HANDHELD_RADAR_TILE_CACHE, 128);
  assert.equal(HANDHELD_RADAR_TILE_CACHE * RADAR_TILE_BYTES, 32 * 1024 * 1024);
  assert.equal(HANDHELD_RADAR_TILES, 320);
  assert.equal(HANDHELD_RADAR_TILES * RADAR_TILE_BYTES, 80 * 1024 * 1024);
  assert.ok(Number.isInteger(DESKTOP_RADAR_TILE_CACHE) && DESKTOP_RADAR_TILE_CACHE >= 512);
});

test("a phone decodes ahead within what it can spare, a desktop most of a loop", () => {
  assert.ok(decodedTileBytes(true) <= 32 * 1024 * 1024);
  assert.ok(decodedTileBytes(false) > decodedTileBytes(true));
  assert.ok(decodeAheadParallel(true) < decodeAheadParallel(false));
});

test("tiles are decoded by two workers on a phone, more where a desktop has the cores", () => {
  assert.equal(decodeWorkers(8, true), 2);
  assert.equal(decodeWorkers(2, false), 2);
  assert.equal(decodeWorkers(4, false), 3);
  assert.equal(decodeWorkers(16, false), 4);
  assert.equal(decodeWorkers(undefined, false), 2);
});

test("the frame layer keeps less in textures on a phone than the radar layers kept between them", () => {
  assert.equal(frameTextureBytes(true), 48 * 1024 * 1024);
  assert.ok(frameTextureBytes(true) < HANDHELD_RADAR_TILES * RADAR_TILE_BYTES, "under the 80 MB the tile layers shared");
  assert.ok(frameTextureBytes(true) / RADAR_TILE_BYTES >= 128, "room for several frames of a phone's screen");
  assert.ok(frameTextureBytes(false) >= decodedTileBytes(false), "a desktop's loop, once decoded, fits on the GPU");
  assert.ok(uploadsPerFrame(true) < uploadsPerFrame(false));
  assert.equal(uploadAheadSteps(true), 1, "a phone's budget has room for one frame more than shown and asked for");
  assert.ok(uploadAheadSteps(false) > uploadAheadSteps(true));
});
