import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEP_TERRAIN_AREA, TERRAIN_COPY_ZOOM, TERRAIN_MAX_ZOOM, isMissingTerrain, terrainTileUrl, tileBounds,
} from "../../src/layers/terrain.ts";

/** The tile at zoom z over a point, as MapLibre numbers it. */
function tileAt(z: number, lon: number, lat: number): [number, number, number] {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [z, Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)];
}

const MATTERHORN = [7.658, 45.976] as const;
const HAMBURG = [9.99, 53.55] as const;

test("our copy answers every zoom it has, anywhere", () => {
  for (const [lon, lat] of [MATTERHORN, HAMBURG]) {
    const url = terrainTileUrl(...tileAt(TERRAIN_COPY_ZOOM, lon, lat));
    assert.match(url ?? "", /^https:\/\/map\.meteocool\.com\/mapterhorn-[^/]+\/12\/\d+\/\d+\.webp$/);
  }
});

test("past our copy, the Alps come from Mapterhorn's endpoint, to the last zoom", () => {
  assert.equal(terrainTileUrl(...tileAt(15, ...MATTERHORN)), "https://tiles.mapterhorn.com/15/17081/11660.webp");
  assert.match(terrainTileUrl(...tileAt(13, ...MATTERHORN)) ?? "", /^https:\/\/tiles\.mapterhorn\.com\/13\//);
});

test("past our copy, nothing is fetched outside the Alps or past the last zoom", () => {
  assert.equal(terrainTileUrl(...tileAt(13, ...HAMBURG)), null);
  assert.equal(terrainTileUrl(...tileAt(TERRAIN_MAX_ZOOM + 1, ...MATTERHORN)), null);
});

test("a tile reaching into the area from outside is fetched", () => {
  const [west, south] = DEEP_TERRAIN_AREA;
  const [z, x, y] = tileAt(14, west - 0.001, south + 1);
  assert.ok(tileBounds(z, x, y)[2] > west, "the tile crosses the western edge");
  assert.notEqual(terrainTileUrl(z, x, y), null);
});

test("tile bounds are west, south, east, north", () => {
  const [west, south, east, north] = tileBounds(...tileAt(15, ...MATTERHORN));
  assert.ok(west <= MATTERHORN[0] && MATTERHORN[0] < east);
  assert.ok(south < MATTERHORN[1] && MATTERHORN[1] <= north);
});

test("only a missing deep tile counts as missing terrain", () => {
  assert.ok(isMissingTerrain(new Error("no deeper terrain at 15/1/2")));
  assert.ok(!isMissingTerrain(new Error("503 for https://tiles.mapterhorn.com/15/1/2.webp")));
  assert.ok(!isMissingTerrain("no deeper terrain"));
});
