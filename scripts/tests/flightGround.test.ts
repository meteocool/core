import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAST_DRAPE_SIZE, LEAST_LOOK_DOWN_M, drapeBytes, drapeSizeWithin, fogDepthRow, fogNear, lodCamera, lookedAtHeight,
} from "../../src/layers/flightGround.ts";

const MB = 1024 * 1024;

test("a few tiles seen from above keep MapLibre's full drapes", () => {
  assert.equal(drapeSizeWithin(16, 512 * MB, 2048, 2048), 2048);
});

test("a cockpit's eighty tiles at the horizon get drapes a quarter the size", () => {
  const size = drapeSizeWithin(79, 512 * MB, 2048, 2048);
  assert.equal(size, 1024);
  assert.ok(79 * drapeBytes(size) <= 512 * MB);
});

test("drapes never go below half a terrain tile, however many tiles", () => {
  assert.equal(drapeSizeWithin(5000, 512 * MB, 2048, 2048), LEAST_DRAPE_SIZE);
});

test("drapes grow back only with room to spare, so a count on the line does not flip them", () => {
  // 22 full drapes fit 512 MB, but not with a quarter to spare: they stay at 1024.
  assert.equal(drapeSizeWithin(22, 512 * MB, 1024, 2048), 1024);
  assert.equal(drapeSizeWithin(15, 512 * MB, 1024, 2048), 2048);
});

test("drapes never grow past their own size (a phone's 1024)", () => {
  assert.equal(drapeSizeWithin(1, 512 * MB, 1024, 1024), 1024);
});

/** A perspective projection's depth and w of an eye-space depth d (d > 0 in front), as [z, w] in clip space. */
const project = (near: number, far: number, d: number) => {
  const p10 = (far + near) / (near - far);
  const p14 = (2 * far * near) / (near - far);
  return { p10, p14, z: -p10 * d + p14, w: d };
};

test("the fog's depth row maps the camera's clip depth to one between the fog's planes", () => {
  const camera = { near: 18, far: 50_000 };
  const fog = { near: 9_000, far: 50_000 };
  const [depth, w] = fogDepthRow(project(camera.near, camera.far, 1).p10, project(camera.near, camera.far, 1).p14, fog.near, fog.far);
  for (const d of [100, 9_000, 20_000, 50_000]) {
    const seen = project(camera.near, camera.far, d);
    const wanted = project(fog.near, fog.far, d);
    const z = depth * seen.z + w * seen.w;
    assert.ok(Math.abs(z / seen.w - wanted.z / wanted.w) < 1e-9, `at ${d}`);
  }
  // The fog's far plane is depth 1, its near one -1.
  const atFar = project(camera.near, camera.far, fog.far);
  assert.ok(Math.abs((depth * atFar.z + w * atFar.w) / atFar.w - 1) < 1e-9);
});

test("the fog's nearer plane is where the line of sight meets the sea, held looking level or up", () => {
  assert.ok(Math.abs(fogNear(1000, 60, 1, 1e9) - 2000) < 1e-6);
  const level = fogNear(1000, 89, 1, 1e9);
  assert.equal(fogNear(1000, 96, 1, 1e9), level);
  assert.equal(fogNear(1000, 120, 1, 1e9), level);
});

test("the fog's nearer plane stays between the map's own planes", () => {
  assert.equal(fogNear(1000, 89, 1, 10_000), 9_000);
  assert.equal(fogNear(0, 0, 18, 10_000), 18);
});

test("the eye looks at the ground under the aircraft, whatever the last look left", () => {
  assert.equal(lookedAtHeight(0, 2444), 0);
  assert.equal(lookedAtHeight(1200, 2444), 1200);
  assert.equal(lookedAtHeight(-400, 2444), -400);
});

test("the plane looked at stays under the eye, skimming the ground or below it", () => {
  assert.equal(lookedAtHeight(2400, 2444), 2444 - LEAST_LOOK_DOWN_M);
  assert.equal(lookedAtHeight(3000, 2444), 2444 - LEAST_LOOK_DOWN_M);
});

test("a low flight's hundred tiles keep 1024-pixel drapes within a desktop's flight budget", async () => {
  const { flightDrapeBytes } = await import("../../src/lib/gpuBudget.ts");
  assert.equal(drapeSizeWithin(100, flightDrapeBytes(false), 1024, 2048), 1024);
  assert.equal(drapeSizeWithin(100, flightDrapeBytes(false), 512, 2048), 1024, "and grow back to it from 512");
});

const RISE = Math.sin((2 * Math.PI) / 180);

test("an eye looking down at the ground is told of as it is", () => {
  // 5,500 m up, looking 30 degrees down: the point looked at is on the ground, 11 km off.
  assert.deepEqual(lodCamera(10, 5500, 11_000, 5500, RISE), { zoom: 10, up: 5500, away: 11_000 });
});

test("an eye looking nearly level is as high as it is, not as the point 10 km ahead has it", () => {
  // Three degrees down: the map looks at a point 10 km ahead, 523 m under the eye.
  const up = 10_000 * Math.sin((3 * Math.PI) / 180);
  const camera = lodCamera(12, up, 10_000, 5500, RISE);
  assert.equal(camera.up, 5500);
  // Looking the same way, at the same size: the same pitch, and the zoom less by as much as the point is further off.
  assert.ok(Math.abs(camera.up / camera.away - up / 10_000) < 1e-12);
  assert.ok(Math.abs(camera.zoom + Math.log2(camera.away) - (12 + Math.log2(10_000))) < 1e-12);
});

test("one tile is as sharp either side of where the map stops looking at the ground", () => {
  // The same eye a hair either side of the angle the map changes at: on the ground 55 km off, or 10 km ahead in the air.
  const over = 5500;
  const down = lodCamera(9.5, over, over / 0.1001, over, RISE);
  const level = lodCamera(9.5 + Math.log2(over / 0.0999 / 10_000), 10_000 * 0.0999, 10_000, over, RISE);
  assert.equal(level.up, down.up);
  assert.ok(Math.abs(level.away - down.away) / down.away < 0.01);
  assert.ok(Math.abs(level.zoom - down.zoom) < 0.01);
});

test("level or up, the eye is never taken to look less than the least angle down", () => {
  const camera = lodCamera(12, 0, 10_000, 5500, RISE);
  assert.equal(camera.up, 5500);
  assert.ok(Math.abs(camera.up / camera.away - RISE) < 1e-12);
  // Low over the ground, that floor is higher than the eye is: left as it was.
  assert.deepEqual(lodCamera(12, 0, 10_000, 100, RISE), { zoom: 12, up: 10_000 * RISE, away: 10_000 });
});

test("an eye looking up steeply, further over its point than over the ground, is left as it is", () => {
  assert.deepEqual(lodCamera(12, 7000, 10_000, 5500, RISE), { zoom: 12, up: 7000, away: 10_000 });
});
