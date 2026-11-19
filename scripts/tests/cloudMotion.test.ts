import assert from "node:assert/strict";
import test from "node:test";
import { cloudMotion, driftKm, mercator, metreAt } from "../../src/lib/cloudMotion.ts";
import type { MotionTile } from "../../src/lib/cloudMotion.ts";

/** Where the synthetic storms are: the Gulf of Lion, as on the demo. */
const [LON, LAT] = [4.6, 43.3];
const METRE = metreAt(LAT);
const [X0, Y0] = mercator(LON, LAT);

/** The point so many km east and north of the reference, as a longitude and latitude. */
function lonLatAt(eastKm: number, northKm: number): [number, number] {
  const x = X0 + eastKm * 1000 * METRE;
  const y = Y0 - northKm * 1000 * METRE;
  const lon = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lon, lat];
}

const TILE_KM = 26;
/** Columns across a tile, apron included: a tile's 250 m grain would be a slow test for nothing. */
const N = 54;
const NZ = 4;

/**
 * A tile of sky whose middle is so many km east and north of the reference,
 * `TILE_KM` across, with an apron of a column, and `dbz` at each point in km
 * east and north filling its lowest two layers.
 */
function tile(key: string, side: 0 | 1, eastKm: number, northKm: number, dbz: (east: number, north: number) => number): MotionTile {
  const [lon, lat] = lonLatAt(eastKm, northKm);
  const step = (TILE_KM * 1000) / (N - 2);
  const voxels = new Uint8Array(N * N * NZ * 2);
  for (let row = 0; row < N; row += 1) {
    for (let column = 0; column < N; column += 1) {
      const east = eastKm + ((column + 0.5) * step) / 1000 - (N * step) / 2000;
      const north = northKm + ((row + 0.5) * step) / 1000 - (N * step) / 2000;
      const value = dbz(east, north);
      if (value <= -31) continue;
      for (let z = 0; z < 2; z += 1) {
        const at = ((z * N + row) * N + column) * 2;
        voxels[at] = Math.round((value + 32) * 2);
        voxels[at + 1] = 255;
      }
    }
  }
  return {
    key,
    side,
    cutaway: {
      header: {
        code: key, reference_time: "2026-11-19T13:08:00Z", lon, lat, nx: N, ny: N, nz: NZ, step_m: [step, step, 500],
        origin_m: [(-N * step) / 2, (-N * step) / 2, 0], dbz_floor: -32, dbz_scale: 2, sites: [], coverage: 1, apron: [1, 1, 0],
      },
      voxels,
      extentM: [N * step, N * step, NZ * 500],
    },
  };
}

/** A storm: 55 dBZ at its middle, falling off over `radius` km, nothing past 1.6 radii. */
const blob = (centreEast: number, centreNorth: number, radius: number) => (east: number, north: number) => {
  const r = Math.hypot(east - centreEast, north - centreNorth) / radius;
  return r > 1.6 ? -32 : 55 - 25 * r * r;
};

/** A storm with some shape to it: a core, a weaker arm to the north-east and a cell off to the south. */
const shaped = (east0: number, north0: number) => (east: number, north: number) => Math.max(
  blob(east0, north0, 5)(east, north),
  blob(east0 + 6, north0 + 5, 3)(east, north) - 8,
  blob(east0 - 3, north0 - 8, 2.5)(east, north) - 4,
);

/** Four tiles around the reference, so a storm spans their seams, as storms do. */
function sky(side: 0 | 1, dbz: (east: number, north: number) => number, prefix = side ? "b" : "a"): MotionTile[] {
  const half = TILE_KM / 2;
  return [[-half, -half], [half, -half], [-half, half], [half, half]].map(([east, north], i) => (
    tile(`${prefix}${i}`, side, east, north, dbz)
  ));
}

const kmOf = (motion: ReturnType<typeof cloudMotion>, key: string) => driftKm(motion.byKey.get(key)!, LAT);

test("a storm shifted by a known amount is found to have moved that far", () => {
  const motion = cloudMotion([...sky(0, shaped(0, 0)), ...sky(1, shaped(4, 3))]);
  const [east, north] = kmOf(motion, "a0");
  assert.ok(Math.abs(east - 4) < 0.4, `east ${east}`);
  assert.ok(Math.abs(north - 3) < 0.4, `north ${north}`);
  // Every tile of the storm, of both scans, moves alike: no seam comes apart.
  for (const key of ["a1", "a2", "a3", "b0", "b1", "b2", "b3"]) assert.deepEqual(motion.byKey.get(key), motion.byKey.get("a0"));
  // One storm in view: all of them together is that one.
  const [allEast, allNorth] = driftKm(motion.all!, LAT);
  assert.ok(Math.hypot(allEast - east, allNorth - north) < 0.1, `all ${allEast}, ${allNorth}`);
});

test("a shift between cells is found between cells", () => {
  const motion = cloudMotion([...sky(0, shaped(0, 0)), ...sky(1, shaped(-2.5, 1.5))]);
  const [east, north] = kmOf(motion, "b2");
  assert.ok(Math.abs(east + 2.5) < 0.35, `east ${east}`);
  assert.ok(Math.abs(north - 1.5) < 0.35, `north ${north}`);
});

test("two storms apart each move their own way", () => {
  // Sixty kilometres apart, one going east, the other south-west.
  const before = (east: number, north: number) => Math.max(shaped(-30, 0)(east, north), shaped(30, 0)(east, north));
  const after = (east: number, north: number) => Math.max(shaped(-25, 0)(east, north), shaped(27, -3)(east, north));
  const west = [0, 1].flatMap((side) => [[-43, -13], [-17, -13], [-43, 13], [-17, 13]].map(([east, north], i) => (
    tile(`${side ? "b" : "a"}w${i}`, side as 0 | 1, east, north, side ? after : before)
  )));
  const east = [0, 1].flatMap((side) => [[17, -13], [43, -13], [17, 13], [43, 13]].map(([eastKm, north], i) => (
    tile(`${side ? "b" : "a"}e${i}`, side as 0 | 1, eastKm, north, side ? after : before)
  )));
  const motion = cloudMotion([...west, ...east]);
  const [we, wn] = kmOf(motion, "aw0");
  const [ee, en] = kmOf(motion, "be3");
  assert.ok(Math.abs(we - 5) < 0.5 && Math.abs(wn) < 0.5, `west ${we}, ${wn}`);
  assert.ok(Math.abs(ee + 3) < 0.5 && Math.abs(en + 3) < 0.5, `east ${ee}, ${en}`);
  assert.deepEqual(motion.byKey.get("bw1"), motion.byKey.get("aw0"));
  assert.deepEqual(motion.byKey.get("ae2"), motion.byKey.get("be3"));
});

test("a storm that grows where it stands does not move", () => {
  const motion = cloudMotion([...sky(0, blob(0, 0, 4)), ...sky(1, blob(0, 0, 7))]);
  const [east, north] = kmOf(motion, "a0");
  assert.ok(Math.hypot(east, north) < 0.5, `${east}, ${north}`);
});

test("a storm that is born stands where it is, and the one beside it moves", () => {
  const before = shaped(-30, 0);
  const after = (east: number, north: number) => Math.max(shaped(-26, 2)(east, north), blob(30, 0, 4)(east, north));
  const tiles = [0, 1].flatMap((side) => [[-43, 0], [-17, 0], [17, 0], [43, 0]].map(([east, north], i) => (
    tile(`${side ? "b" : "a"}${i}`, side as 0 | 1, east, north, side ? after : before)
  )));
  const motion = cloudMotion(tiles);
  // The newborn storm, matched against nothing earlier, keeps where it is: it fades in, not slides in.
  const [east, north] = kmOf(motion, "b3");
  const [westEast, westNorth] = kmOf(motion, "a0");
  assert.ok(Math.abs(westEast - 4) < 0.5 && Math.abs(westNorth - 2) < 0.5, `west ${westEast}, ${westNorth}`);
  assert.ok(Math.hypot(east, north) < 0.5, `newborn ${east}, ${north}`);
});

test("no echo at all moves nothing", () => {
  const motion = cloudMotion([...sky(0, () => -32), ...sky(1, () => -32)]);
  assert.equal(motion.all, null);
  for (const drift of motion.byKey.values()) assert.deepEqual(drift, [0, 0]);
});

test("tiles of one scan only move nothing", () => {
  const motion = cloudMotion(sky(0, shaped(0, 0)));
  assert.equal(motion.all, null);
  assert.equal(motion.byKey.size, 4);
  for (const drift of motion.byKey.values()) assert.deepEqual(drift, [0, 0]);
});
