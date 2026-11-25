import assert from "node:assert/strict";
import test from "node:test";
import {
  LEAST_DRAPE_SIZE, LEAST_LOOK_DOWN_M, drapeBytes, drapeMatrix, drapeSizeWithin, drapesOver, fogDepthRow, fogNear, lodCamera, lookedAtHeight,
  type TilePlace,
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

/** Where a matrix puts a point of a tile, in the drape's clip space. */
const drawnAt = (matrix: Float32Array, x: number, y: number) => [matrix[0] * x + matrix[12], matrix[5] * y + matrix[13]];

test("a tile fills the drape of its own terrain tile", () => {
  const matrix = drapeMatrix({ z: 9, x: 270, y: 180 }, { z: 9, x: 270, y: 180 });
  assert.ok(matrix);
  assert.deepEqual(drawnAt(matrix, 0, 0), [-1, 1]);
  assert.deepEqual(drawnAt(matrix, 8192, 8192), [1, -1]);
});

test("a drape inside a tile is drawn that part of it, and a tile inside a drape fills its part", () => {
  // The drape's tile is the lower right quarter of the tile: the tile's middle is the drape's top left.
  const part = drapeMatrix({ z: 10, x: 541, y: 361 }, { z: 9, x: 270, y: 180 });
  assert.ok(part);
  assert.deepEqual(drawnAt(part, 4096, 4096), [-1, 1]);
  assert.deepEqual(drawnAt(part, 8192, 8192), [1, -1]);
  // And the other way round the tile is the drape's lower right quarter.
  const quarter = drapeMatrix({ z: 9, x: 270, y: 180 }, { z: 10, x: 541, y: 361 });
  assert.ok(quarter);
  assert.deepEqual(drawnAt(quarter, 0, 0), [0, 0]);
  assert.deepEqual(drawnAt(quarter, 8192, 8192), [1, -1]);
});

test("tiles apart from each other share no drape", () => {
  assert.equal(drapeMatrix({ z: 9, x: 270, y: 180 }, { z: 9, x: 271, y: 180 }), null);
  assert.equal(drapeMatrix({ z: 10, x: 542, y: 361 }, { z: 9, x: 270, y: 180 }), null);
  assert.equal(drapeMatrix({ z: 9, x: 270, y: 180 }, { z: 11, x: 1084, y: 720 }), null);
});

test("looking the drapes up finds what trying every one of them does", () => {
  // A cockpit's terrain: fine tiles near, coarser ones out to the horizon, one of them twice (the world wrapped).
  const drapes: Array<[string, TilePlace]> = [];
  for (let z = 6; z <= 12; z += 1) {
    for (let dx = 0; dx < 5; dx += 1) for (let dy = 0; dy < 4; dy += 1) drapes.push([`${z}/${dx}/${dy}`, { z, x: (35 << (z - 6)) + dx, y: (22 << (z - 6)) + dy }]);
  }
  drapes.push(["again", { z: 6, x: 35, y: 22 }], ["world", { z: 0, x: 0, y: 0 }]);
  const over = drapesOver(drapes);
  let found = 0;
  for (let z = 0; z <= 14; z += 1) {
    for (let dx = -1; dx < 6; dx += 1) for (let dy = -1; dy < 5; dy += 1) {
      const tile = z >= 6 ? { z, x: (35 << (z - 6)) + dx, y: (22 << (z - 6)) + dy } : { z, x: (35 >> (6 - z)) + dx, y: (22 >> (6 - z)) + dy };
      const tried = drapes.flatMap(([name, place]) => {
        const matrix = drapeMatrix(place, tile);
        return matrix ? [[name, [...matrix]] as const] : [];
      }).sort(([a], [b]) => (a < b ? -1 : 1));
      const looked = over(tile).map(([name, matrix]) => [name, [...matrix]] as const).sort(([a], [b]) => (a < b ? -1 : 1));
      assert.deepEqual(looked, tried, `${z}/${tile.x}/${tile.y}`);
      found += looked.length;
    }
  }
  assert.ok(found > 500);
});
