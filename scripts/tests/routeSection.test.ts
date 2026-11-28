import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceM } from "../../src/lib/studio/flight/geo.ts";
import {
  alongOf, echoByte, pointAlong, SECTION_AHEAD_M, SECTION_BEHIND_M, sectionAlong, trackPath, trackSection,
} from "../../src/lib/studio/flight/routeSection.ts";

/** A volume 40 km square and 16 km tall over a point, 1 km voxels by 1 km levels, with echo where `fill` says. */
function volume(lon: number, lat: number, fill: (x: number, y: number, z: number) => number) {
  const [nx, ny, nz] = [40, 40, 16];
  const voxels = new Uint8Array(nx * ny * nz * 2);
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const at = ((z * ny + y) * nx + x) * 2;
        voxels[at] = fill(x, y, z);
        voxels[at + 1] = 255;
      }
    }
  }
  const header = { lon, lat, nx, ny, nz, step_m: [1000, 1000, 1000], dbz_floor: -32, dbz_scale: 2 };
  return { header, voxels, extentM: [40_000, 40_000, 16_000] } as unknown as Parameters<typeof sectionAlong>[0] extends Iterable<infer V> ? V : never;
}

test("a reflectivity is stored where the palette's ramp has it, and nothing as nothing", () => {
  assert.equal(echoByte(null), 0);
  assert.equal(echoByte(-Infinity), 0);
  assert.equal(echoByte(-32), 1);
  assert.equal(echoByte(16), 128);
  assert.equal(echoByte(64), 255);
  assert.equal(echoByte(80), 255);
});

test("a track's path runs from behind the aircraft to ahead of it, in legs that follow the Earth", () => {
  const path = trackPath(10, 45, 90, 5_000, 160_000);
  const along = alongOf(path);
  assert.ok(Math.abs(along[along.length - 1] - 165_000) < 200);
  assert.ok(path.length >= 5);
  // West of the aircraft at its start, east at its end, and through it.
  assert.ok(path[0][0] < 10 && path[path.length - 1][0] > 10);
  const [lon, lat] = pointAlong(path, along, 5_000);
  assert.ok(distanceM(lon, lat, 10, 45) < 100);
});

test("the section holds the echo over each point of the path at each height, the ground's row first", () => {
  // Echo of 40 dBZ from 2 to 6 km up, everywhere in the volume.
  const held = [volume(10.3, 45, (_x, _y, z) => (z >= 2 && z < 6 ? (40 + 32) * 2 : 0))];
  const section = sectionAlong(held, trackPath(10, 45, 90, 0, 60_000));
  const at = (alongM: number, altitude: number) => section.echo[
    Math.floor((altitude / section.topM) * section.rows) * section.columns + Math.floor((alongM / section.lengthM) * section.columns)
  ];
  // The volume's west edge is about 3.6 km along; before it there is nothing held.
  assert.equal(at(1_000, 4_000), 0);
  assert.equal(at(25_000, 4_000), echoByte(40));
  // Held, and empty: below the echo and above it.
  assert.equal(at(25_000, 1_000), 0);
  assert.equal(at(25_000, 8_000), 0);
  // And past its east edge, nothing again.
  assert.equal(at(55_000, 4_000), 0);
});

test("where two volumes overlap, the stronger echo is the section's", () => {
  const held = [volume(10.2, 45, () => (20 + 32) * 2), volume(10.3, 45, () => (50 + 32) * 2)];
  const section = sectionAlong(held, trackPath(10, 45, 90, 0, 40_000));
  const column = Math.floor((20_000 / section.lengthM) * section.columns);
  assert.equal(section.echo[4 * section.columns + column], echoByte(50));
});

test("a flight's section marks the aircraft: where along it, and how high", () => {
  const section = trackSection([], { lon: 10, lat: 45, track: 30, altitude: 6_100 });
  assert.deepEqual(section.mark, { alongM: SECTION_BEHIND_M, altitude: 6_100 });
  assert.ok(Math.abs(section.lengthM - (SECTION_BEHIND_M + SECTION_AHEAD_M)) < 200);
  assert.ok(section.echo.every((byte) => byte === 0));
});
