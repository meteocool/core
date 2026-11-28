import assert from "node:assert/strict";
import test from "node:test";
import { dwdDetections, MESO_STORM_M, mesoRadiusPx, stormAtMesocyclone } from "../../src/lib/mesocyclones.ts";

/**
 * A tap on a mesocyclone opens the storm it turns in: the tracked one
 * nearest it, if any is near enough to be its own.
 */

const storms = [
  { storm: "far", coordinates: [10.0, 50.0] as [number, number] },
  { storm: "near", coordinates: [10.3, 50.0] as [number, number] },
  { storm: "nearer", coordinates: [10.36, 50.01] as [number, number] },
];

test("a mesocyclone is the nearest tracked storm's", () => {
  assert.equal(stormAtMesocyclone(storms, 10.37, 50.0), "nearer");
  assert.equal(stormAtMesocyclone(storms, 10.01, 50.0), "far");
});

test("a mesocyclone no storm is near belongs to none", () => {
  // 0.3° of longitude at 50° north is about 21 km.
  assert.equal(stormAtMesocyclone(storms.slice(0, 1), 10.3, 50.0), null);
  assert.equal(stormAtMesocyclone([], 10.3, 50.0), null);
  assert.ok(MESO_STORM_M < 21_000);
});

test("a stronger mesocyclone is a larger ring to tap", () => {
  assert.ok(mesoRadiusPx(5) > mesoRadiusPx(1));
  assert.ok(mesoRadiusPx(1) >= 10);
});

test("only DWD's detections are drawn as mesocyclones, never a rotation signature", () => {
  const list = [
    { time: 1, source: "dwd", intensity: 2 },
    { time: 2, source: "meteocool", shear_max: 5e-3 },
    // Before there were signatures, no source: DWD's.
    { time: 3, intensity: 1 },
    { time: 4, source: "someone else" },
  ];
  assert.deepEqual(dwdDetections<{ time: number }>(list).map((entry) => entry.time), [1, 3]);
  assert.deepEqual(dwdDetections({ detail: "error" }), []);
  assert.deepEqual(dwdDetections([null, 7]), []);
});
