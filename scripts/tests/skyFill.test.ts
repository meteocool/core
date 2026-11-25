import assert from "node:assert/strict";
import test from "node:test";
import { drawnPieces } from "../../src/layers/cellVolumeLayer.ts";
import { drawnPart, tilePart } from "../../src/lib/volumeBox.ts";
import type { CutawayHeader } from "../../src/lib/cellCutaway.ts";
import {
  atLevel, coveringTiles, drawnWithin, freedAsTiles, volumesAsked, weakParts,
} from "../../src/lib/volumeLevels.ts";
import type { RadarVolume } from "../../src/api/index.ts";

/**
 * meteoair draws the whole sky: the coarse zoom-9 tiles over the storms, the
 * fill tiles over the weak rain between them, and close up the storms' own
 * tiles. A coarse tile drawn as its tiles keeps its weak echo where none of
 * them lies; the 3D map draws a coarse tile whole or not at all, as before.
 */

/** A listed volume at a tile, of the German network unless said. */
const volume = (tile: [number, number, number], extra: Partial<RadarVolume> = {}): RadarVolume => ({
  path: `v/${tile.join("-")}${extra.network ? `-${extra.network}` : ""}${extra.fill ? "-fill" : ""}`,
  code: `T${tile.join("")}`,
  coverage: 1,
  lon: 0,
  lat: 0,
  reference_time: "2026-11-25T12:00:00Z",
  network: "de",
  tier: 2,
  coarse: tile[0] === 9,
  fill: false,
  sites: [],
  tile,
  ...extra,
});

// A coarse tile and the four zoom-10 tiles under it: x 2*268.., y 2*177..
const COARSE: [number, number, number] = [9, 268, 177];
const NW: [number, number, number] = [10, 536, 354];
const NE: [number, number, number] = [10, 537, 354];
const SW: [number, number, number] = [10, 536, 355];
const SE: [number, number, number] = [10, 537, 355];

test("a coarse tile with no tile of its storm in it is left whole", () => {
  assert.deepEqual(weakParts(COARSE, []), [COARSE]);
});

test("a coarse tile whose quarters all hold a storm's tile has no weak part left", () => {
  assert.deepEqual(weakParts(COARSE, [NW, NE, SW, SE]), []);
});

test("the quarters without a storm's tile are the weak parts, whole", () => {
  assert.deepEqual(weakParts(COARSE, [NW]), [NE, SW, SE]);
  assert.deepEqual(weakParts(COARSE, [NW, SE]), [NE, SW]);
});

test("a core's tile left out of a quarter is a weak part of its own", () => {
  // The north-west quarter is a core's: three of its four zoom-11 tiles were boxed.
  const cores: Array<[number, number, number]> = [[11, 1072, 708], [11, 1073, 708], [11, 1072, 709]];
  assert.deepEqual(weakParts(COARSE, [...cores, SE]), [[11, 1073, 709], NE, SW]);
});

test("a tile elsewhere covers nothing of it", () => {
  assert.deepEqual(weakParts(COARSE, [[10, 600, 354], [9, 269, 177]]), [COARSE]);
});

test("every network's tiles under a coarse tile cover it, its own and its neighbours'", () => {
  const parent = volume(COARSE);
  const tiles = [volume(NW), volume(NE, { network: "fr" }), volume(SW, { coarse: true }), volume([10, 600, 354])];
  assert.deepEqual(coveringTiles(parent, tiles), [NW, NE]);
});

/** Coarse where nothing was put in `fine`. */
const coarseUnless = (...fine: Array<readonly number[]>) => (tile: readonly number[]) => (
  !fine.some((one) => one.join() === tile.join())
);

test("on the map a coarse tile drawn as its tiles is not drawn at all", () => {
  const listed = [volume(COARSE), volume(NW), volume(SE)];
  const drawn = atLevel(listed, coarseUnless(COARSE)).map((cloud) => cloud.path);
  assert.deepEqual(drawn, [volume(NW).path, volume(SE).path]);
});

test("drawing the whole sky, a coarse tile drawn as its tiles stays for its weak parts", () => {
  const listed = [volume(COARSE), volume(NW), volume(SE)];
  const drawn = atLevel(listed, coarseUnless(COARSE), null, { covers: () => true }).map((cloud) => cloud.path);
  assert.deepEqual(drawn, [volume(COARSE).path, volume(NW).path, volume(SE).path]);
});

test("drawing the whole sky, a coarse tile its tiles cover all of goes as on the map", () => {
  const listed = [volume(COARSE), volume(NW), volume(NE), volume(SW), volume(SE)];
  const drawn = atLevel(listed, coarseUnless(COARSE), null, { covers: () => true }).map((cloud) => cloud.path);
  assert.ok(!drawn.includes(volume(COARSE).path));
  assert.equal(drawn.length, 4);
});

test("a tile that will not be drawn covers nothing: its quarter keeps the coarse tile's weak echo", () => {
  const listed = [volume(COARSE), volume(NW), volume(NE), volume(SW), volume(SE)];
  const faint = volume(SE).path;
  const drawn = atLevel(listed, coarseUnless(COARSE), null, { covers: (cloud) => cloud.path !== faint });
  assert.ok(drawn.some((cloud) => cloud.path === volume(COARSE).path));
});

test("a coarse tile drawn whole is drawn whole either way, and a fill tile with it", () => {
  const fill = volume([9, 269, 177], { fill: true, tier: 1 });
  const listed = [volume(COARSE), volume(NW), fill];
  for (const weak of [null, { covers: () => true }]) {
    const drawn = atLevel(listed, () => true, null, weak).map((cloud) => cloud.path);
    assert.deepEqual(drawn, [volume(COARSE).path, fill.path]);
  }
});

test("a fill tile over a neighbouring network's storm: drawn whole far off, standing in for it", () => {
  // A French fill tile with a Swiss storm's tile under it, and no Swiss coarse tile.
  const fill = volume(COARSE, { network: "fr", fill: true, tier: 1 });
  const storm = volume(SE, { network: "ch" });
  for (const weak of [null, { covers: () => true }]) {
    const drawn = atLevel([fill, storm], () => true, null, weak).map((cloud) => cloud.path);
    assert.deepEqual(drawn, [fill.path]);
  }
});

test("a fill tile over a neighbouring network's storm: close up, drawn around it, never over it", () => {
  const fill = volume(COARSE, { network: "fr", fill: true, tier: 1 });
  const storm = volume(SE, { network: "ch" });
  const drawn = atLevel([fill, storm], coarseUnless(COARSE), null, { covers: () => true }).map((cloud) => cloud.path);
  assert.deepEqual(drawn, [fill.path, storm.path]);
  const within = drawnWithin([{ key: fill.path, tile: COARSE }, { key: storm.path, tile: SE }]);
  assert.deepEqual(within.get(fill.path), [NW, NE, SW]);
  assert.equal(within.has(storm.path), false);
});

test("a coarse tile over its own storm and a neighbour's is drawn around both", () => {
  const coarse = volume(COARSE);
  const own = volume(NW);
  const neighbours = volume(SE, { network: "pl" });
  const drawn = atLevel([coarse, own, neighbours], coarseUnless(COARSE), null, { covers: () => true });
  assert.deepEqual(drawn.map((cloud) => cloud.path), [coarse.path, own.path, neighbours.path]);
  const within = drawnWithin([coarse, own, neighbours].map((cloud) => ({ key: cloud.path, tile: cloud.tile! })));
  assert.deepEqual(within.get(coarse.path), [NE, SW]);
});

test("a coarse tile its own and a neighbour's tiles cover all of is not drawn over them", () => {
  const coarse = volume(COARSE, { network: "dk" });
  const tiles = [volume(NW, { network: "dk" }), volume(NE, { network: "pl" }), volume(SW, { network: "pl" }), volume(SE, { network: "dk" })];
  const drawn = atLevel([coarse, ...tiles], coarseUnless(COARSE), null, { covers: () => true });
  assert.ok(!drawn.includes(coarse));
  const within = drawnWithin([coarse, ...tiles].map((cloud) => ({ key: cloud.path, tile: cloud.tile! })));
  assert.deepEqual(within.get(coarse.path), []);
});

test("a zoom-9 tile with nothing finer drawn in it is drawn whole", () => {
  const within = drawnWithin([{ key: "fill", tile: COARSE }, { key: "elsewhere", tile: [10, 600, 354] }]);
  assert.equal(within.get("fill"), null);
});

test("what drawing a zoom-9 tile as its tiles frees agrees with what is drawn of it", () => {
  const own = 186_624;
  // No tile under it: it stays coarse.
  assert.equal(freedAsTiles(COARSE, [volume([10, 600, 354])], own), null);
  // A neighbour's storm under a fill tile: kept for its weak parts, nothing freed.
  assert.equal(freedAsTiles(COARSE, [volume(SE, { network: "ch" })], own), 0);
  // Its own storm in one quarter: the same.
  assert.equal(freedAsTiles(COARSE, [volume(NW)], own), 0);
  // Every quarter covered, by two networks: all of it freed.
  assert.equal(freedAsTiles(COARSE, [volume(NW), volume(NE, { network: "pl" }), volume(SW), volume(SE, { network: "pl" })], own), own);
});

test("the map asks for its coarse tiles alone, meteoair for the fill tiles too", () => {
  assert.deepEqual(volumesAsked(false, null), { coarse: true, at: null });
  assert.ok(!("fill" in volumesAsked(false, 1764072000)));
  assert.deepEqual(volumesAsked(true, 1764072000), { coarse: true, fill: true, at: 1764072000 });
});

/** A coarse tile's header: 52 voxels across, one more each side of apron. */
const HEADER = {
  nx: 54, ny: 54, nz: 32, step_m: [1000, 1000, 500], origin_m: [-27_000, -27_000, 0], tile: COARSE, apron: [1, 1, 0],
} as unknown as CutawayHeader;

const near = (a: readonly number[], b: readonly number[]) => a.every((value, i) => Math.abs(value - b[i]) < 1e-12);

test("a quarter of a coarse tile is that quarter of its drawn box, north up", () => {
  const { min, max } = drawnPart(HEADER);
  const half = (min[0] + max[0]) / 2;
  const north = tilePart(HEADER, NW)!;
  assert.ok(near(north.min, [min[0], half, 0]) && near(north.max, [half, max[1], 1]), "north-west");
  const south = tilePart(HEADER, SE)!;
  assert.ok(near(south.min, [half, min[1], 0]) && near(south.max, [max[0], half, 1]), "south-east");
  // A core's tile, the north-west's own north-east quarter.
  const core = tilePart(HEADER, [11, 1073, 708])!;
  const span = max[0] - min[0];
  assert.ok(near(core.min, [min[0] + span / 4, min[1] + (span * 3) / 4, 0]));
  assert.ok(near(core.max, [half, max[1], 1]));
  assert.equal(tilePart(HEADER, [10, 600, 354]), null);
});

test("a cloud drawn over some of its tile is marched there alone, each part in order as a tile of its own", () => {
  const box = drawnPart(HEADER);
  assert.deepEqual(drawnPieces(HEADER, box, null), [{ box, tile: COARSE }]);
  const pieces = drawnPieces(HEADER, box, [NE, SW]);
  assert.deepEqual(pieces.map(({ tile }) => tile), [NE, SW]);
  assert.deepEqual(pieces.map(({ box: part }) => part), [tilePart(HEADER, NE), tilePart(HEADER, SW)]);
  // Its echo only in the north-west quarter: nothing of it to march in the others.
  const echo = { min: [0.1, 0.6, 0] as [number, number, number], max: [0.4, 0.9, 0.5] as [number, number, number] };
  assert.deepEqual(drawnPieces(HEADER, echo, [NE, SW, SE]), []);
});
