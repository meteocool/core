import assert from "node:assert/strict";
import test from "node:test";
import { isFaint, solidKm2 } from "../../src/layers/cellVolumeLayer.ts";
import type { Cutaway } from "../../src/lib/cellCutaway.ts";

const [NX, NY, NZ] = [160, 160, 32];

/** A box as the worker builds it, with `fill` deciding each voxel's dBZ and confidence. */
function box(fill: (x: number, y: number, z: number) => [number, number] | null): Cutaway {
  const voxels = new Uint8Array(NX * NY * NZ * 2);
  for (let z = 0; z < NZ; z += 1) {
    for (let y = 0; y < NY; y += 1) {
      for (let x = 0; x < NX; x += 1) {
        const voxel = fill(x, y, z);
        if (!voxel) continue;
        const at = ((z * NY + y) * NX + x) * 2;
        voxels[at] = Math.round((voxel[0] + 32) * 2);
        voxels[at + 1] = Math.round(voxel[1] * 255);
      }
    }
  }
  return {
    header: {
      code: "G1", reference_time: "2026-10-01T07:11:00Z", lon: 17.655, lat: 51.165,
      nx: NX, ny: NY, nz: NZ, step_m: [250, 250, 500], origin_m: [-20000, -20000, 0],
      dbz_floor: -32, dbz_scale: 2, sites: ["plpoz"], coverage: 1,
    },
    voxels,
    extentM: [40000, 40000, 16000],
    centreKm: [0, 0, 0],
    halfKm: [4, 4, 4],
  };
}

/** A column `km` across and `tallKm` high in the middle of the box, all at one reflectivity. */
const column = (dbz: number, km: number, tallKm: number, confidence = 1) => box((x, y, z) => {
  // 250 m a voxel across, 500 m up.
  const half = (km * 4) / 2;
  const inside = Math.abs(x - NX / 2) < half && Math.abs(y - NY / 2) < half && z < tallKm * 2;
  return inside ? [dbz, confidence] : null;
});

test("an empty box shows nothing", () => {
  assert.equal(solidKm2(box(() => null)), 0);
  assert.ok(isFaint(box(() => null)));
});

test("a box of echo just over the shader's floor is faint, however much of it there is", () => {
  // The staging volume this was written for: a few hundred voxels at 20 to
  // 21.5 dBZ under a composite peak of 60, which drew as nothing at all.
  assert.ok(isFaint(column(21, 4, 2)));
  assert.equal(solidKm2(column(21, 4, 2)), 0);
});

test("a small core of real echo is drawn", () => {
  // 3 by 3 km of 45 dBZ, 6 km tall: opaque from above and from both sides.
  const core = column(45, 3, 6);
  assert.ok(solidKm2(core) >= 9);
  assert.ok(!isFaint(core));
});

test("a core the radars barely saw is as faint as the shader draws it", () => {
  // Same storm, confidence a twentieth: the shader multiplies opacity by it.
  assert.ok(isFaint(column(45, 3, 6, 0.05)));
});

test("a shield too thin to see from above still shows at the map's tilt", () => {
  // 1 km deep of 30 dBZ over 10 by 10 km: under half opaque looking straight
  // down through it, but the map looks through it at a slant.
  assert.ok(!isFaint(column(30, 10, 1)));
});

test("a wide, thin, weak shield is faint, though it would be a wall from the side", () => {
  // 1 km of 24 dBZ filling the box: forty kilometres of it along the ground
  // is opaque, but nothing looks along the ground.
  assert.ok(isFaint(column(24, 40, 1)));
});
