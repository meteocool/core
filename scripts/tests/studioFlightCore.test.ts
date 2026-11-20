import assert from "node:assert/strict";
import test from "node:test";
import { coreBox } from "../../src/layers/scenicPass.ts";
import type { CutawayHeader } from "../../src/lib/cellCutaway.ts";

/*
 * The box a storm seen through has its core marched in: of a tile, the part
 * that holds echo that strong and is near enough the storm looked into.
 */

const [NX, NY, NZ] = [20, 20, 8];
/** A tile 20 km across of kilometre voxels, a voxel of apron on each side, with these voxels of echo in it. */
function tile(echo: ReadonlyArray<[x: number, y: number, z: number, dbz: number]>) {
  const voxels = new Uint8Array(NX * NY * NZ * 2);
  for (const [x, y, z, dbz] of echo) {
    const at = ((z * NY + y) * NX + x) * 2;
    voxels[at] = Math.round((dbz + 32) * 2);
    voxels[at + 1] = 255;
  }
  const header = { nx: NX, ny: NY, nz: NZ, dbz_floor: -32, dbz_scale: 2, apron: [1, 1, 0] } as unknown as CutawayHeader;
  return { header, voxels, extentM: [20_000, 20_000, 8_000] as [number, number, number] };
}

test("a core is marched where the strong echo is, a voxel wider, and not in the rain round it", () => {
  const storm = tile([[10, 10, 3, 55], [11, 10, 4, 48], [4, 15, 1, 30]]);
  const box = coreBox(storm, 40, [0.5, 0.5], 40)!;
  assert.deepEqual(box.min, [9 / 20, 9 / 20, 2 / 8]);
  assert.deepEqual(box.max, [13 / 20, 12 / 20, 6 / 8]);
});

test("a tile with no echo that strong has no core to march", () => {
  assert.equal(coreBox(tile([[4, 15, 1, 30]]), 40, [0.5, 0.5], 40), null);
});

test("a core at a tile's side stops where the tile does: the apron is its neighbour's", () => {
  const box = coreBox(tile([[0, 10, 3, 55], [1, 10, 3, 55]]), 40, [0.5, 0.5], 40)!;
  assert.deepEqual([box.min[0], box.max[0]], [1 / 20, 3 / 20]);
  // Echo in the apron alone still reaches a voxel into the tile, as the field is read between the two.
  const edge = coreBox(tile([[0, 10, 3, 55]]), 40, [0.5, 0.5], 40)!;
  assert.deepEqual([edge.min[0], edge.max[0]], [1 / 20, 2 / 20]);
});

test("a core is marched no further from the storm looked into than it is drawn", () => {
  const storm = tile([[3, 10, 3, 55], [16, 10, 3, 55]]);
  // Looked into at the tile's middle, 5 km out: 0.25 of it each way.
  const near = coreBox(storm, 40, [0.5, 0.5], 5)!;
  assert.deepEqual([near.min[0], near.max[0]], [0.25, 0.75]);
  // Looked into 30 km west of the tile's west side, 20 km out: none of it.
  assert.equal(coreBox(storm, 40, [-1.5, 0.5], 20), null);
  // From a tile away to the east, 15 km out: only its eastern core.
  const east = coreBox(storm, 40, [1.5, 0.5], 15)!;
  assert.deepEqual([east.min[0], east.max[0]], [0.75, 18 / 20]);
});

test("another floor is another box of the same volume", () => {
  const storm = tile([[10, 10, 3, 55], [5, 5, 1, 42]]);
  assert.equal(coreBox(storm, 40, [0.5, 0.5], 40)!.min[0], 4 / 20);
  assert.equal(coreBox(storm, 50, [0.5, 0.5], 40)!.min[0], 9 / 20);
  assert.equal(coreBox(storm, 40, [0.5, 0.5], 40)!.min[0], 4 / 20);
});
