import assert from "node:assert/strict";
import test from "node:test";
import { destination } from "../../src/lib/studio/flight/geo.ts";
import { inRadarGap, radarGapAlong } from "../../src/lib/studio/flight/radarGaps.ts";
import { approachTo, chooseApproach, rankSystems, stormSystems } from "../../src/lib/studio/flight/spawn.ts";
import type { StormTile } from "../../src/lib/studio/flight/spawn.ts";

const tile = (lon: number, lat: number, peakDbz: number): StormTile => ({ lon, lat, peakDbz, areaKm2: 400, coarse: true, tile: [9, 0, 0] });

test("Austria is where the radar sees little; its neighbours are not", () => {
  for (const [lon, lat] of [[16.37, 48.21], [11.4, 47.27], [13.04, 47.8], [15.44, 47.07], [9.75, 47.25], [14.3, 46.62]]) {
    assert.ok(inRadarGap(lon, lat), `${lon}, ${lat}`);
  }
  for (const [lon, lat] of [[11.58, 48.14], [8.54, 47.37], [11.34, 46.5], [14.51, 46.06], [14.42, 50.09], [19.04, 47.5], [10.9, 48.37]]) {
    assert.ok(!inRadarGap(lon, lat), `${lon}, ${lat}`);
  }
  // Munich to Vienna runs mostly through it; Munich to Stuttgart not at all.
  assert.ok(radarGapAlong(11.58, 48.14, 100, 400) > 0.6);
  assert.equal(radarGapAlong(11.58, 48.14, 280, 190), 0);
});

test("a storm in Austria is offered after an equal one beside it, even looked at from Austria", () => {
  const tirol = stormSystems([tile(11.4, 47.27, 58)])[0];
  const bavaria = stormSystems([tile(11.6, 48.1, 58)])[0];
  assert.deepEqual(rankSystems([tirol, bavaria], 11.4, 47.27)[0], bavaria);
  // Alone on the radar, it is still offered.
  assert.deepEqual(rankSystems([tirol], 11.4, 47.27)[0], tirol);
  // N in flight comes to it last.
  const tiles = [tile(11.4, 47.27, 62), tile(11.6, 48.1, 50)];
  assert.equal(chooseApproach(tiles, { lon: 11, lat: 48, bearing: 0 }, null).target!.peakDbz, 50);
});

test("the way in to a storm by the border does not run on into Austria", () => {
  // Rosenheim, just north of the Tyrol: with the sun behind, the way in would be from the south-west, over the Alps.
  const tiles = [tile(12.12, 47.86, 58)];
  const system = stormSystems(tiles)[0];
  const approach = approachTo(system, tiles);
  const [lon, lat] = [approach.lon, approach.lat];
  assert.ok(!inRadarGap(lon, lat), `starts at ${lon}, ${lat}`);
  assert.ok(radarGapAlong(lon, lat, approach.heading, 150) < 0.15, `heading ${approach.heading}`);
  // And it heads somewhere other than straight on into it.
  const [x, y] = destination(lon, lat, approach.heading, 150_000);
  assert.ok(!inRadarGap(x, y));
});
