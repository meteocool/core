import assert from "node:assert/strict";
import test from "node:test";
import file from "../../src/lib/radarHorizons.json";
import { loadHorizons, smoothed } from "../../src/lib/radarHorizons.ts";
import { RADAR_SITES } from "../../src/lib/radarSites.ts";

/**
 * The radars' terrain-limited reach, as ng's `horizons.py` wrote it and as
 * the minimap draws it.
 */

test("every radar the site table knows has a horizon, a range a degree", () => {
  const sites = file.sites as Record<string, number[]>;
  for (const code of Object.keys(RADAR_SITES)) {
    assert.ok(sites[code], `${code} has no horizon`);
    assert.equal(sites[code].length, 360, code);
  }
});

test("no horizon reaches past the radar's own range", () => {
  for (const [code, ranges] of Object.entries(file.sites as Record<string, number[]>)) {
    assert.ok(Math.max(...ranges) <= Math.ceil(RADAR_SITES[code].rangeKm), code);
  }
});

test("smoothing drops a lone spike but keeps a mountain's sector", () => {
  const ranges = Array.from({ length: 360 }, () => 150);
  ranges[10] = 20;
  for (let i = 100; i < 140; i++) ranges[i] = 60;
  const out = smoothed(ranges);
  assert.equal(out[10], 150);
  assert.equal(out[120], 60);
  assert.equal(out[100], 60);
  assert.equal(out[99], 150);
});

test("smoothing wraps round north", () => {
  const ranges = Array.from({ length: 360 }, () => 150);
  ranges[358] = ranges[359] = ranges[0] = ranges[1] = ranges[2] = 40;
  assert.equal(smoothed(ranges)[0], 40);
});

test("a horizon is found by EUMETNET's code and by DWD's bare three letters", async () => {
  const horizons = await loadHorizons();
  assert.equal(horizons.heightKm, 3);
  assert.deepEqual(horizons.of("ISN"), horizons.of("deisn"));
  assert.equal(horizons.of("xxnope"), null);
});
