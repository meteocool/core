import assert from "node:assert/strict";
import test from "node:test";
import { carryCut, cutAway, cutPointOf, kmFromCut, peelFloors } from "../../src/layers/cellVolumeLayer.ts";
import {
  drawnExtentM, drawnPart, echoPart, overlap, parentOf, tileBounds, tileCentre, tileCode,
} from "../../src/lib/volumeBox.ts";
import type { Cutaway, CutawayHeader } from "../../src/lib/cellCutaway.ts";
import { atLevel, fineAt } from "../../src/lib/volumeLevels.ts";
import type { RadarVolume } from "../../src/api/index.ts";

/** A tile's header as the worker writes it: 104 voxels across, one more each side of apron. */
const TILE = {
  nx: 106, ny: 106, nz: 32, step_m: [251, 251, 500], origin_m: [-53 * 251, -53 * 251, 0],
  tile: [10, 544, 355], apron: [1, 1, 0],
} as unknown as CutawayHeader;
/** A box from before tiles, which has no apron. */
const BOX = { nx: 160, ny: 160, nz: 32, step_m: [250, 250, 500], origin_m: [-20_000, -20_000, 0] } as unknown as CutawayHeader;

const extentOf = (header: CutawayHeader): [number, number, number] => [
  header.nx * header.step_m[0], header.ny * header.step_m[1], header.nz * header.step_m[2],
];

test("a tile draws itself and not the apron borrowed from its neighbours", () => {
  const { min, max } = drawnPart(TILE);
  assert.deepEqual(min, [1 / 106, 1 / 106, 0]);
  assert.deepEqual(max, [105 / 106, 105 / 106, 1]);
  const [x, y, z] = drawnExtentM({ header: TILE, extentM: extentOf(TILE) });
  assert.ok(Math.abs(x - 104 * 251) < 1e-6 && Math.abs(y - 104 * 251) < 1e-6);
  assert.equal(z, 16_000);
});

test("a box from before tiles is drawn whole", () => {
  assert.deepEqual(drawnPart(BOX), { min: [0, 0, 0], max: [1, 1, 1] });
  assert.deepEqual(drawnExtentM({ header: BOX, extentM: extentOf(BOX) }), [40_000, 40_000, 16_000]);
});

test("one storm's tiles peel to the floor of its strongest core", () => {
  // Each to its own floor, the weak tile emptied while its neighbour still
  // stood, and the seam between them flickered through every peel.
  const floors = peelFloors([
    ["weak", { system: "T1", coreDbz: 28, peels: true }],
    ["core", { system: "T1", coreDbz: 52, peels: true }],
    ["other", { system: "T2", coreDbz: 33, peels: true }],
    ["old", { system: null, coreDbz: 41, peels: true }],
  ]);
  assert.deepEqual(Object.fromEntries(floors), { weak: 52, core: 52, other: 33, old: 41 });
});

test("a tile held whole sets no floor and takes none", () => {
  // One not seen well enough to open does not peel: its layers are interpolation.
  const floors = peelFloors([
    ["seen", { system: "T1", coreDbz: 30, peels: true }],
    ["unseen", { system: "T1", coreDbz: 60, peels: false }],
  ]);
  assert.equal(floors.get("seen"), 30);
  assert.equal(floors.get("unseen"), 20);
});

/** A model matrix as the layer builds one: the unit cube onto a Mercator square. */
const model = (x: number, y: number, size: number, height: number) => new Float64Array([
  size, 0, 0, 0, 0, -size, 0, 0, 0, 0, height, 0, x, y + size, 0, 1,
]);

test("the cut through the opened tile passes through the storm, not the middle of its box", () => {
  const opened = model(0.5, 0.3, 0.001, 0.0002);
  const point = cutPointOf(opened, { extentM: [26_000, 26_000, 16_000], centreKm: [6.5, -3.25, 4] });
  // 6.5 km east of the middle of 26 km is three quarters of the way across;
  // 3.25 km south is three eighths up from the south edge.
  assert.ok(Math.abs(point[0] - (0.5 + 0.75 * 0.001)) < 1e-12);
  assert.ok(Math.abs(point[1] - (0.3 + 0.001 - 0.375 * 0.001)) < 1e-12);
  // The cut is vertical, so its height says nothing about where it falls.
});

test("the opened tile's cut, carried into the next tile east, is the same plane", () => {
  const opened = model(0.5, 0.3, 0.001, 0.0002);
  const east = model(0.501, 0.3, 0.001, 0.0002);
  const point: [number, number, number] = [0.5008, 0.3005, 0.0001];
  const along = (30 * Math.PI) / 180;

  const there = carryCut(east, opened, point, along);
  const here = carryCut(opened, opened, point, along);

  // In the opened tile's own cube, the plane is where the layer always put it.
  assert.deepEqual(here.normal.map((v) => v.toFixed(12)), [Math.cos(along), -Math.sin(along), 0].map((v) => v.toFixed(12)));
  // One tile east, the same point is one cube further west.
  assert.ok(Math.abs(there.point[0] - (here.point[0] - 1)) < 1e-9);
  assert.ok(Math.abs(there.point[1] - here.point[1]) < 1e-9);
  // A point on the plane in one cube is on it in the other, where the scales match.
  const side = (cut: { normal: number[]; point: number[] }, p: number[]) => (
    cut.normal.reduce((sum, n, i) => sum + n * (p[i] - cut.point[i]), 0)
  );
  const onPlane = [here.point[0] - Math.sin(along) * 0.2, here.point[1] - Math.cos(along) * 0.2, 0.3];
  assert.ok(Math.abs(side(here, onPlane)) < 1e-12);
  assert.ok(Math.abs(side(there, [onPlane[0] - 1, onPlane[1], onPlane[2]])) < 1e-9);
});

test("a neighbour's distance from the cut is to the nearest edge of its box", () => {
  // 0.001 Mercator units of tile at 25 km a tile: 25 metres to the unit.
  const metre = 0.001 / 25_000;
  const whole = { min: [0, 0, 0], max: [1, 1, 1] };
  const point: [number, number, number] = [0.5005, 0.3005, 0];
  assert.equal(kmFromCut(model(0.5, 0.3, 0.001, 0.0002), whole, point, metre), 0);
  // The next tile east starts 12.5 km east of the point, the one past it 37.5 km.
  assert.ok(Math.abs(kmFromCut(model(0.501, 0.3, 0.001, 0.0002), whole, point, metre) - 12.5) < 1e-9);
  assert.ok(Math.abs(kmFromCut(model(0.502, 0.3, 0.001, 0.0002), whole, point, metre) - 37.5) < 1e-9);
  // Diagonally, to its corner; and to the box drawn, not the tile.
  const corner = kmFromCut(model(0.501, 0.301, 0.001, 0.0002), whole, point, metre);
  assert.ok(Math.abs(corner - Math.hypot(12.5, 12.5)) < 1e-9);
  const eastHalf = { min: [0.5, 0, 0], max: [1, 1, 1] };
  assert.ok(Math.abs(kmFromCut(model(0.501, 0.3, 0.001, 0.0002), eastHalf, point, metre) - 25) < 1e-9);
});

test("a box wholly on the cut-away side is not drawn", () => {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as Array<[number, number, number]>;
  const east = { normal: [1, 0, 0] as [number, number, number], point: [0.5, 0, 0] as [number, number, number] };
  assert.equal(cutAway(corners, east), false);
  assert.equal(cutAway(corners, { ...east, point: [-0.1, 0, 0] }), true);
  assert.equal(cutAway(corners, { ...east, point: [1.1, 0, 0] }), false);
});

test("a box is marched only where it holds echo, a voxel wider", () => {
  const [nx, ny, nz] = [10, 8, 6];
  const voxels = new Uint8Array(nx * ny * nz * 2);
  const put = (x: number, y: number, z: number, dbz: number, seen = 255) => {
    const at = ((z * ny + y) * nx + x) * 2;
    voxels[at] = Math.round((dbz + 32) * 2);
    voxels[at + 1] = seen;
  };
  put(4, 3, 1, 45);
  put(6, 5, 2, 30);
  put(0, 0, 5, 15); // drizzle, never drawn
  put(9, 7, 5, 50, 0); // never seen
  const header = { nx, ny, nz, dbz_floor: -32, dbz_scale: 2 } as unknown as CutawayHeader;

  const part = echoPart({ header, voxels }, 20)!;

  assert.deepEqual(part.min, [3 / 10, 2 / 8, 0]);
  assert.deepEqual(part.max, [8 / 10, 7 / 8, 4 / 6]);
  assert.equal(echoPart({ header, voxels: new Uint8Array(nx * ny * nz * 2) }, 20), null);
});

test("echo near a tile's edge is marched up to the edge, never into the apron", () => {
  const cut = overlap({ min: [1 / 106, 1 / 106, 0], max: [105 / 106, 105 / 106, 1] }, { min: [0, 0.4, 0], max: [0.3, 1, 0.5] });
  assert.deepEqual(cut, { min: [1 / 106, 0.4, 0], max: [0.3, 105 / 106, 0.5] });
});

test("a tile code is the worker's: T, the zoom in two digits, x and y in five", () => {
  assert.equal(tileCode(10, 544, 355), "T100054400355");
  assert.equal(tileCode(11, 1089, 711), "T110108900711");
});

test("a tile's centre is its middle in Mercator, as the worker places it", () => {
  const [lon, lat] = tileCentre(10, 544, 355);
  assert.ok(Math.abs(lon - 11.42578125) < 1e-9);
  // What the worker's `Tile.centre` gives for row 355.
  assert.ok(Math.abs(lat - 48.1074311884804) < 1e-9);
});

/** A core tile of 4 inner voxels a side and an apron of 1, two levels deep, every voxel marked by `mark`. */
function child(x: number, y: number, mark: (column: number, row: number) => number): Cutaway {
  const [n, nz] = [6, 2];
  const voxels = new Uint8Array(n * n * nz * 2);
  for (let level = 0; level < nz; level += 1) {
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const at = ((level * n + row) * n + column) * 2;
        voxels[at] = mark(column, row);
        voxels[at + 1] = 255;
      }
    }
  }
  const header = {
    code: tileCode(11, x, y), nx: n, ny: n, nz, step_m: [250, 250, 500], origin_m: [-750, -750, 0],
    tile: [11, x, y], apron: [1, 1, 0], sites: [`s${x}${y}`], coverage: 0.8, dbz_floor: -32, dbz_scale: 2,
  } as unknown as CutawayHeader;
  return { header, voxels, extentM: [1500, 1500, 1000], centreKm: [0, 0, 0], halfKm: [1, 1, 1] };
}

test("a core tile's parent is its four siblings side by side, their outer aprons its own", () => {
  // Each child marks its inner voxels with its quarter (1 NW, 2 NE, 3 SW, 4 SE)
  // and its apron with 9, so where every voxel came from can be read back.
  const quarter = { "100,200": 1, "101,200": 2, "100,201": 3, "101,201": 4 } as Record<string, number>;
  const children = [[100, 200], [101, 200], [100, 201], [101, 201]].map(([x, y]) => child(x, y, (column, row) => (
    column === 0 || row === 0 || column === 5 || row === 5 ? 9 : quarter[`${x},${y}`]
  )));
  const placed = (header: CutawayHeader, voxels: Uint8Array) => ({ header, voxels }) as unknown as Cutaway;

  const parent = parentOf(children[2], children, placed);

  const { header, voxels } = parent;
  assert.equal(header.nx, 10);
  assert.deepEqual(header.tile, [10, 50, 100]);
  assert.deepEqual(header.sites, ["s100200", "s100201", "s101200", "s101201"]);
  const at = (column: number, row: number, level = 0) => voxels[((level * 10 + row) * 10 + column) * 2];
  // Rows run south to north: the south-west child fills the lower left.
  assert.equal(at(1, 1), 3);
  assert.equal(at(4, 4), 3);
  assert.equal(at(5, 4), 4);
  assert.equal(at(4, 5), 1);
  assert.equal(at(8, 8, 1), 2);
  // The parent's apron is its children's outer aprons; inside, no apron is left.
  assert.equal(at(0, 3), 9);
  assert.equal(at(9, 7), 9);
  assert.equal(at(3, 9), 9);
  for (let row = 1; row < 9; row += 1) for (let column = 1; column < 9; column += 1) assert.notEqual(at(column, row), 9);
});

test("a sibling that was never built leaves its quarter of the parent empty", () => {
  const children = [child(100, 200, () => 50), null, child(100, 201, () => 50), child(101, 201, () => 50)];
  const placed = (header: CutawayHeader, voxels: Uint8Array) => ({ header, voxels }) as unknown as Cutaway;

  const { voxels } = parentOf(children[0]!, children, placed);

  const at = (column: number, row: number) => voxels[(row * 10 + column) * 2 + 1];
  assert.equal(at(7, 7), 0);
  assert.equal(at(2, 7), 255);
});

const listed = (path: string, tile: number[] | null, coarse = false) => (
  { path, tile, coarse, peak_dbz: 40 } as unknown as RadarVolume
);

test("zoomed out, a coarse tile stands in for the tiles in it, and never beside them", () => {
  const clouds = [
    listed("coarse", [9, 272, 177], true),
    listed("in", [10, 544, 354]),
    listed("core-in", [11, 1089, 709]),
    listed("elsewhere", [10, 600, 354]),
    listed("old-box", null),
  ];

  assert.deepEqual(atLevel(clouds, () => true).map((cloud) => cloud.path), ["coarse", "elsewhere", "old-box"]);
  assert.deepEqual(atLevel(clouds, () => false).map((cloud) => cloud.path), ["in", "core-in", "elsewhere", "old-box"]);
});

test("an open tile keeps its own picture zoomed out, and its coarse tile steps aside", () => {
  const clouds = [listed("coarse", [9, 272, 177], true), listed("in", [10, 544, 354]), listed("next", [10, 545, 354])];

  assert.deepEqual(atLevel(clouds, () => true, "in").map((cloud) => cloud.path), ["in", "next"]);
});

test("each coarse tile is coarse or fine on its own: near ones fine, far ones coarse", () => {
  const clouds = [
    listed("near", [9, 272, 177], true), listed("near-tile", [10, 544, 354]),
    listed("far", [9, 280, 170], true), listed("far-tile", [10, 560, 340]),
  ];
  const coarse = (tile: readonly number[]) => tile[1] === 280;

  assert.deepEqual(atLevel(clouds, coarse).map((cloud) => cloud.path), ["far", "near-tile"]);
});

test("a tile's bounds are the map's tile edges", () => {
  const [west, south, east, north] = tileBounds(10, 544, 355);
  assert.ok(Math.abs(west - 11.25) < 1e-9 && Math.abs(east - 11.6015625) < 1e-9);
  const [, centreLat] = tileCentre(10, 544, 355);
  assert.ok(south < centreLat && centreLat < north);
  assert.deepEqual(tileBounds(10, 544, 354).slice(1, 2), [north]);
});

test("a tap on a coarse tile opens the finest tile under it", () => {
  const clouds = [listed("coarse", [9, 272, 177], true), listed("tile", [10, 544, 355]), listed("core", [11, 1089, 710])];

  // Munich is in tile 544/355 and in its core tile 1089/710; 11.35 E 48.0 N is
  // in the same tile but in core tile 1088/711, which is not listed.
  assert.equal(fineAt(clouds, 11.576, 48.137)?.path, "core");
  assert.equal(fineAt(clouds, 11.35, 48.0)?.path, "tile");
  assert.equal(fineAt(clouds, 2.35, 48.85), null);
});
