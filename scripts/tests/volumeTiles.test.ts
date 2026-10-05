import assert from "node:assert/strict";
import test from "node:test";
import { carryCut, cutPointOf, peelFloors } from "../../src/layers/cellVolumeLayer.ts";
import { drawnExtentM, drawnPart, echoPart, overlap } from "../../src/lib/volumeBox.ts";
import type { CutawayHeader } from "../../src/lib/cellCutaway.ts";

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
