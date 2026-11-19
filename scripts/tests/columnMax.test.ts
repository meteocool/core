import assert from "node:assert/strict";
import test from "node:test";
import { columnMax } from "../../src/layers/cellVolumeLayer.ts";
import { HULL_TINT } from "../../src/lib/cloudStyle.ts";
import type { Cutaway } from "../../src/lib/cellCutaway.ts";

const [NX, NY, NZ] = [8, 6, 24];
const STEP_Z = 500;
const byteOf = (dbz: number) => Math.round((dbz + 32) * 2);
const dbzOf = (byte: number) => byte / 2 - 32;

/** A small box, 500 m a layer, with `fill` deciding each voxel's dBZ and confidence. */
function box(fill: (x: number, y: number, z: number) => [number, number] | null): Pick<Cutaway, "header" | "voxels"> {
  const voxels = new Uint8Array(NX * NY * NZ * 2);
  for (let z = 0; z < NZ; z += 1) {
    for (let y = 0; y < NY; y += 1) {
      for (let x = 0; x < NX; x += 1) {
        const voxel = fill(x, y, z);
        if (!voxel) continue;
        const at = ((z * NY + y) * NX + x) * 2;
        voxels[at] = byteOf(voxel[0]);
        voxels[at + 1] = Math.round(voxel[1] * 255);
      }
    }
  }
  return {
    header: {
      code: "G1", reference_time: "2026-10-01T07:11:00Z", lon: 17.655, lat: 51.165,
      nx: NX, ny: NY, nz: NZ, step_m: [250, 250, STEP_Z], origin_m: [-1000, -750, 0],
      dbz_floor: -32, dbz_scale: 2, sites: ["plpoz"], coverage: 1,
    },
    voxels,
  };
}

/** The layer whose middle is this high, in km. */
const layerAt = (km: number) => Math.round((km * 1000) / STEP_Z - 0.5);

test("a column is as strong as its strongest echo aloft", () => {
  const column = columnMax(box((_x, _y, z) => (z === layerAt(7) ? [48, 1] : z === layerAt(5) ? [30, 1] : null)));
  assert.equal(column.length, NX * NY);
  for (const byte of column) assert.equal(dbzOf(byte), 48);
});

test("echo under the height the tint starts at does not count, however strong", () => {
  // The melting layer of a rain shield: strong, low, and not a storm.
  const below = HULL_TINT.aloftKm - 1.5;
  const column = columnMax(box((_x, _y, z) => (z === layerAt(below) ? [45, 1] : z === layerAt(6) ? [24, 1] : null)));
  for (const byte of column) assert.equal(dbzOf(byte), 24);
});

test("echo the radars saw poorly counts for 20 dBZ less", () => {
  const column = columnMax(box((_x, _y, z) => (z === layerAt(6) ? [50, 0] : null)));
  for (const byte of column) assert.equal(dbzOf(byte), 30);
});

test("one strong column is softened into its neighbours, not left a speck", () => {
  const column = columnMax(box((x, y, z) => (x === 4 && y === 3 && z === layerAt(8) ? [60, 1] : null)));
  const at = (x: number, y: number) => column[y * NX + x];
  // The weights are 4 in the middle, 2 beside and 1 across a corner, of 16.
  assert.equal(at(4, 3), Math.round(byteOf(60) * 4 / 16));
  assert.equal(at(5, 3), Math.round(byteOf(60) * 2 / 16));
  assert.equal(at(5, 4), Math.round(byteOf(60) / 16));
  assert.equal(at(7, 0), 0);
});
