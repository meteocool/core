import assert from "node:assert/strict";
import test from "node:test";
import { radarTileCounts, radarTileOutcome, TILE_WINDOW_MS } from "../../src/lib/tileStatus.ts";
import { API_MATCH } from "../../src/lib/degradedStatus.ts";

/**
 * What the `tile-errors` and `slow-responses` criteria count: the radar's
 * tiles over the last two minutes, and the calls that are the backend's.
 */

test("radar tiles are counted over the last two minutes only", () => {
  const start = 10_000_000;
  radarTileOutcome(false, start);
  radarTileOutcome(true, start + 1000);
  assert.deepEqual(radarTileCounts(start + 2000), { asked: 2, failed: 1 });
  // The failure ages out first.
  assert.deepEqual(radarTileCounts(start + TILE_WINDOW_MS + 500), { asked: 1, failed: 0 });
  assert.deepEqual(radarTileCounts(start + TILE_WINDOW_MS + 5000), { asked: 0, failed: 0 });
});

test("the backend's calls are the API's and the data service's, not tiles", () => {
  for (const url of [
    "https://api.meteocool.com/v3/status",
    "https://data.meteocool.com/lightning_cache",
    "https://data.meteocool.com/mesocyclones/all/",
    "https://data.meteocool.com/storms?bbox=1,2,3,4",
    "https://data.meteocool.com/cells/volumes",
    "https://data.meteocool.com/stations/observations",
    "https://data.meteocool.com/sweeps?site=deess",
  ]) assert.ok(API_MATCH.test(url), url);
  for (const url of [
    "https://assets.meteocool.com/tiles/meteoradar/abc/6/33/21.png",
    "https://map.meteocool.com/tiles/v4/6/33/21.pbf",
  ]) assert.ok(!API_MATCH.test(url), url);
});
