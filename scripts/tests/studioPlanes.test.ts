import assert from "node:assert/strict";
import test from "node:test";
import {
  carryPlane, clipPlanes, flipped, foldDegrees, isLevel, mercatorOf, nextPlaneId, normalOf, planeAt, pushed,
} from "../../src/lib/studio/planes.ts";
import type { SectionPlane } from "../../src/lib/studio/planes.ts";
import { cutAway } from "../../src/layers/cellVolumeLayer.ts";
import { sheetCorners } from "../../src/layers/studioPlanesLayer.ts";

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);
const nearAll = (a: readonly number[], b: readonly number[], tolerance = 1e-9) => a.forEach((value, i) => near(value, b[i], tolerance));

const plane = (patch: Partial<SectionPlane> = {}): SectionPlane => ({
  id: 1, lon: 10, lat: 50, heightKm: 0, facingDeg: 0, tiltDeg: 0, slabKm: null, enabled: true, ...patch,
});

test("an upright plane faces along the ground, a level one straight up or down", () => {
  nearAll(normalOf({ facingDeg: 0, tiltDeg: 0 }), [0, 1, 0]);
  nearAll(normalOf({ facingDeg: 90, tiltDeg: 0 }), [1, 0, 0]);
  nearAll(normalOf({ facingDeg: 0, tiltDeg: 90 }), [0, 0, 1]);
  nearAll(normalOf({ facingDeg: 123, tiltDeg: -90 }), [0, 0, -1]);
  assert.equal(isLevel({ tiltDeg: 90 }), true);
  assert.equal(isLevel({ tiltDeg: -90 }), true);
  assert.equal(isLevel({ tiltDeg: 45 }), false);
});

test("flipping a plane keeps the other side, whichever way it stands", () => {
  for (const [facingDeg, tiltDeg] of [[0, 0], [200, 30], [90, 90], [10, -90]]) {
    const before = normalOf({ facingDeg, tiltDeg });
    const after = normalOf(flipped(plane({ facingDeg, tiltDeg })));
    nearAll(after, before.map((value) => -value));
  }
  assert.equal(flipped(plane({ facingDeg: 270 })).facingDeg, 90);
});

test("pushing a plane moves its point along the way it faces", () => {
  const north = pushed(plane({ facingDeg: 0 }), 11.1195);
  near(north.lat, 50.1, 1e-6);
  near(north.lon, 10);
  const up = pushed(plane({ tiltDeg: 90, heightKm: 4 }), 2);
  near(up.heightKm, 6);
  near(up.lat, 50, 1e-9);
  // East by as many degrees as the latitude makes of the kilometres.
  const east = pushed(plane({ facingDeg: 90 }), 10);
  near(east.lon, 10 + 10 / (111.195 * Math.cos((50 * Math.PI) / 180)), 1e-9);
});

test("a plane off cuts nothing, and a slab is two cuts facing each other", () => {
  assert.deepEqual(clipPlanes([plane({ enabled: false })]), []);
  assert.equal(clipPlanes([plane()]).length, 1);
  const [face, back] = clipPlanes([plane({ facingDeg: 0, slabKm: 11.1195 })]);
  nearAll(face.normal, [0, 1, 0]);
  nearAll(back.normal, [0, -1, 0]);
  near(back.lat, 49.9, 1e-6);
});

test("a new plane stands where the camera looks, its cut towards the camera", () => {
  const upright = planeAt(2, { lon: 8, lat: 47, bearing: 30 }, "upright");
  assert.equal(upright.facingDeg, 210);
  assert.equal(upright.tiltDeg, 0);
  assert.deepEqual([upright.lon, upright.lat], [8, 47]);
  const level = planeAt(3, { lon: 8, lat: 47, bearing: 30 }, "level");
  assert.equal(level.tiltDeg, 90);
  assert.ok(level.heightKm > 0);
  assert.equal(foldDegrees(-10), 350);
  assert.equal(foldDegrees(360), 0);
});

test("a new plane takes an id nothing else has, a keyframe's included", () => {
  assert.equal(nextPlaneId([]), 1);
  assert.equal(nextPlaneId([plane({ id: 1 }), plane({ id: 3 })]), 2);
  assert.equal(nextPlaneId([plane({ id: 1 })], [2, 3]), 4);
});

/* A 40 by 40 by 16 km box centred on 10E 50N, as the clouds' layer stands
   one on the map: scaled to its extent in Mercator, its y running north. */
const EXTENT_M = [40_000, 40_000, 16_000];
function boxModel(lon: number, lat: number): number[] {
  const [x, y] = mercatorOf(lon, lat);
  const metre = 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180));
  const [sx, sy, sz] = EXTENT_M.map((extent) => extent * metre);
  return [sx, 0, 0, 0, 0, -sy, 0, 0, 0, 0, sz, 0, x - sx / 2, y + sy / 2, 0, 1];
}

test("a plane through a box's middle lands in the middle of its cube", () => {
  const model = boxModel(10, 50);
  const [clip] = clipPlanes([plane({ lon: 10, lat: 50, heightKm: 8, facingDeg: 90 })]);
  const carried = carryPlane(model, EXTENT_M, clip);
  nearAll(carried.point, [0.5, 0.5, 0.5], 1e-6);
  // Facing east: the cube's x, and nothing of its y or z.
  assert.ok(carried.normal[0] > 0);
  near(carried.normal[1], 0, 1e-6);
  near(carried.normal[2], 0, 1e-6);
});

test("north in the cube is up its y, whatever Mercator does", () => {
  const model = boxModel(10, 50);
  // Ten kilometres north of the middle: a quarter of the box further up y.
  const [clip] = clipPlanes([pushed(plane({ facingDeg: 0 }), 10)]);
  const carried = carryPlane(model, EXTENT_M, clip);
  near(carried.point[1], 0.75, 2e-3);
  assert.ok(carried.normal[1] > 0);
});

test("a box wholly on the removed side of a plane is not drawn", () => {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const carried = (patch: Partial<SectionPlane>) => carryPlane(boxModel(10, 50), EXTENT_M, clipPlanes([plane(patch)])[0]);
  // A wall well south of the box, facing north: the whole box is on the side it takes.
  assert.equal(cutAway(corners, carried({ lat: 49, facingDeg: 0 })), true);
  // The same wall facing south takes none of it, and one through the middle only half.
  assert.equal(cutAway(corners, carried({ lat: 49, facingDeg: 180 })), false);
  assert.equal(cutAway(corners, carried({ lat: 50, facingDeg: 0 })), false);
  // A ceiling under the ground takes everything; one above the box's top, nothing.
  assert.equal(cutAway(corners, carried({ tiltDeg: 90, heightKm: -1 })), true);
  assert.equal(cutAway(corners, carried({ tiltDeg: 90, heightKm: 17 })), false);
});

test("a wall's sheet stands from the ground to the storms' top, a level one lies flat", () => {
  const wall = sheetCorners(plane({ facingDeg: 0 }), 20);
  // Facing north, it runs east to west.
  assert.deepEqual(wall.map(([east]) => Math.round(east)), [-20, 20, 20, -20]);
  wall.forEach(([, north]) => near(north, 0, 1e-9));
  assert.deepEqual(wall.map(([, , up]) => Math.round(up)).sort((a, b) => a - b), [0, 0, 16, 16]);
  const floor = sheetCorners(plane({ tiltDeg: 90, heightKm: 5 }), 20);
  floor.forEach(([, , up]) => near(up, 0, 1e-9));
  assert.equal(Math.round(Math.max(...floor.map(([east]) => east))), 20);
});
