import assert from "node:assert/strict";
import test from "node:test";
import {
  ageMinutes, covers, ellipseRing4326, padExtent,
} from "../../src/lib/cellGeometry.ts";

/**
 * The geometry behind the storm cell layer.
 *
 * Two things here are easy to get wrong and impossible to see wrong: DWD gives
 * an uncertainty ellipse as a bearing rather than a maths angle, so a mixed-up
 * rotation still draws a plausible ellipse pointing the wrong way; and the
 * viewport padding decides how often a pan costs a request, which only shows up
 * as a slow map on a phone.
 */

const KM_PER_DEGREE_LAT = 111.32;

/** Rough distance in km from a ring point back to the centre it was built around. */
const kmFromCentre = ([plon, plat]: number[], lon: number, lat: number): number => {
  const lonScale = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((plon - lon) * lonScale, (plat - lat) * KM_PER_DEGREE_LAT);
};

const farthest = (ring: number[][], lon: number, lat: number) => (
  ring.reduce((a, b) => (kmFromCentre(b, lon, lat) > kmFromCentre(a, lon, lat) ? b : a))
);

test("an ellipse angle is a bearing, so zero points north", () => {
  const [lon, lat] = farthest(ellipseRing4326(10, 50, 10, 2, 0), 10, 50);

  assert.ok(lat > 50, `expected the long axis north of the centre, got ${lat}`);
  assert.ok(Math.abs(lon - 10) < 0.01, `expected no eastward offset, got ${lon}`);
});

test("ninety degrees points east, not west", () => {
  const [lon, lat] = farthest(ellipseRing4326(10, 50, 10, 2, 90), 10, 50);

  assert.ok(lon > 10, `expected the long axis east of the centre, got ${lon}`);
  assert.ok(Math.abs(lat - 50) < 0.01, `expected no northward offset, got ${lat}`);
});

test("the axes come back the length they were given", () => {
  const ring = ellipseRing4326(10, 50, 10, 4, 45);
  const distances = ring.map((point) => kmFromCentre(point, 10, 50));

  assert.ok(Math.abs(Math.max(...distances) - 10) < 0.1);
  assert.ok(Math.abs(Math.min(...distances) - 4) < 0.1);
});

test("a circle is a circle at any bearing", () => {
  const distances = ellipseRing4326(10, 50, 5, 5, 123).map((p) => kmFromCentre(p, 10, 50));

  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.01);
});

test("the ring closes, so it draws as a polygon rather than an arc", () => {
  const ring = ellipseRing4326(10, 50, 5, 3, 30);

  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("an ellipse stays the right shape far from the equator", () => {
  // A degree of longitude is about half a degree of latitude at 60N; an ellipse
  // built without that correction comes out visibly squashed.
  const distances = ellipseRing4326(10, 60, 8, 8, 0).map((p) => kmFromCentre(p, 10, 60));

  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.05);
});

test("padding grows the viewport by a fraction of its own size", () => {
  assert.deepEqual(padExtent([0, 0, 10, 20], 0.25), [-2.5, -5, 12.5, 25]);
});

test("a move inside what was already fetched needs no request", () => {
  const fetched: [number, number, number, number] = [0, 0, 10, 10];

  assert.equal(covers(fetched, [2, 2, 8, 8]), true);
  assert.equal(covers(fetched, [0, 0, 10, 10]), true);
});

test("a move that reveals anything new does need one", () => {
  const fetched: [number, number, number, number] = [0, 0, 10, 10];

  assert.equal(covers(fetched, [-1, 2, 8, 8]), false);
  assert.equal(covers(fetched, [2, 2, 11, 8]), false);
  assert.equal(covers(null, [2, 2, 8, 8]), false, "nothing fetched yet");
});

test("age is measured from the last detection", () => {
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);
  const lastSeen = new Date(Date.UTC(2026, 6, 1, 11, 30, 0)).toISOString();

  assert.equal(ageMinutes(lastSeen, now), 30);
});
