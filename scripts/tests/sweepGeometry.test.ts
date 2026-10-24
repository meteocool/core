import assert from "node:assert/strict";
import test from "node:test";
import { alongBeam, beamHeightRings, binAt, fromSite, groundAtHeight, reachM, stormRelative } from "../../src/lib/sweepGeometry.ts";
import { beamHeightKm } from "../../src/lib/radarSites.ts";

/** Emden's 0.5 degree tilt as the backend publishes it: 360 rays from 0.5 degrees, 720 bins of 250 m. */
const EMDEN = {
  lat: 53.564129, lon: 6.748317, height_m: 36.2, elevation_deg: 0.5,
  range_start_m: 0, range_step_m: 250, nrays: 360, nbins: 720, azimuth0_deg: 0.518, azimuth_step_deg: 1,
};

test("a point due north of a site is at bearing 0, east at 90", () => {
  const north = fromSite(10, 50, 10, 51);
  assert.ok(Math.abs(north.azimuthDeg) < 1e-9 || Math.abs(north.azimuthDeg - 360) < 1e-9);
  assert.ok(Math.abs(north.groundM - 111_195) < 50);
  assert.ok(Math.abs(fromSite(10, 50, 10.5, 50).azimuthDeg - 90) < 0.3);
});

test("the beam's height agrees with the one the volumes panel draws", () => {
  // radarSites.beamHeightKm takes a slant range; at 100 km of ground they differ by metres.
  const { slantM, heightM } = alongBeam(100_000, 0.5);
  const panel = beamHeightKm(slantM / 1000, 0.5, 0) * 1000;
  assert.ok(Math.abs(heightM - panel) < 1, `${heightM} against ${panel}`);
});

test("the ground distance at a beam height is the inverse of the beam height", () => {
  for (const elevation of [0.5, 1.5, 5.5]) {
    const ground = groundAtHeight(2000, elevation);
    assert.ok(Math.abs(alongBeam(ground, elevation).heightM - 2000) < 0.01);
  }
});

test("a point lands in the bin and ray that cover it", () => {
  // 50 km due east of Emden: ray 89 (89.518 degrees) or 90 (90.518); bin by slant range.
  const lon = EMDEN.lon + 50_000 / (111_195 * Math.cos((EMDEN.lat * Math.PI) / 180));
  const bin = binAt(EMDEN, lon, EMDEN.lat)!;
  assert.ok(bin.ray === 89 || bin.ray === 90, `ray ${bin.ray}`);
  assert.equal(bin.bin, Math.floor(bin.slantM / 250));
  assert.ok(Math.abs(bin.groundM - 50_000) < 500);
  // The beam centre, above sea level: the antenna's own 36 m plus the beam's rise.
  assert.ok(Math.abs(bin.heightM - (alongBeam(bin.groundM, 0.5).heightM + 36.2)) < 1e-6);
});

test("a point past the last bin is in no bin", () => {
  assert.equal(binAt(EMDEN, EMDEN.lon, EMDEN.lat + 2), null);
  assert.ok(Math.abs(reachM(EMDEN) - 180_000) < 200);
});

test("rays wrap round north", () => {
  const justWest = binAt(EMDEN, EMDEN.lon - 0.001, EMDEN.lat + 0.3)!;
  assert.equal(justWest.ray, 359);
  assert.ok(Math.abs(justWest.azimuthDeg - 359.518) < 1e-9);
});

test("beam height rings are whole kilometres, nearest first, inside the sweep", () => {
  const rings = beamHeightRings(EMDEN);
  assert.deepEqual(rings.map((ring) => ring.heightM), [1000, 2000, 3000]);
  assert.ok(rings.every((ring, i) => i === 0 || ring.groundM > rings[i - 1].groundM));
  assert.ok(rings.every((ring) => ring.groundM <= reachM(EMDEN)));
});

test("storm-relative velocity takes the storm's motion along the ray out", () => {
  const motion = { speedMs: 10, headingDeg: 90 };
  // Looking the way the storm goes, its own motion is all away.
  assert.ok(Math.abs(stormRelative(12, 90, motion) - 2) < 1e-9);
  // Across its track, none of it.
  assert.ok(Math.abs(stormRelative(12, 0, motion) - 12) < 1e-9);
  // Behind it, all toward.
  assert.ok(Math.abs(stormRelative(-12, 270, motion) - -2) < 1e-9);
});
