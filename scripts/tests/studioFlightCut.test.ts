import assert from "node:assert/strict";
import test from "node:test";
import { CUT_HALF_KM, CUT_HALF_MOST_KM, CUT_PUSH_KM, CUT_WIDENS, cutThrough, facingFrom, moved, UNSET_CUT } from "../../src/lib/studio/flight/cut.ts";
import { bearingDeg, distanceM } from "../../src/lib/studio/flight/geo.ts";

const storm = { lon: 4.6, lat: 43.3 };

test("a cut is first set facing the aircraft, the side towards it taken away", () => {
  const west = facingFrom(UNSET_CUT, { lon: 4.0, lat: 43.3 }, storm);
  assert.ok(Math.abs(west.facingDeg! - 270) < 0.5, `${west.facingDeg}`);
  assert.equal(west.pushKm, 0);
});

test("a cut with no push passes through the storm's middle", () => {
  assert.deepEqual(cutThrough(storm, { facingDeg: 90, pushKm: 0 }), { ...storm, facingDeg: 90, halfKm: CUT_HALF_KM });
});

test("pushed deeper, a cut moves away from the side it takes away", () => {
  const cut = cutThrough(storm, { facingDeg: 90, pushKm: 5 });
  assert.ok(Math.abs(distanceM(storm.lon, storm.lat, cut.lon, cut.lat) - 5000) < 1);
  assert.ok(Math.abs(bearingDeg(storm.lon, storm.lat, cut.lon, cut.lat) - 270) < 0.5);
});

test("a cut far off is drawn wider, up to a most", () => {
  assert.equal(cutThrough(storm, { facingDeg: 0, pushKm: 0 }, 20).halfKm, CUT_HALF_KM);
  assert.equal(cutThrough(storm, { facingDeg: 0, pushKm: 0 }, 200).halfKm, 200 * CUT_WIDENS);
  assert.equal(cutThrough(storm, { facingDeg: 0, pushKm: 0 }, 2000).halfKm, CUT_HALF_MOST_KM);
});

test("turning wraps round the compass and pushing stops at its reach", () => {
  const set = moved({ facingDeg: 355, pushKm: CUT_PUSH_KM - 1 }, 10, 3);
  assert.equal(set.facingDeg, 5);
  assert.equal(set.pushKm, CUT_PUSH_KM);
  assert.equal(moved({ facingDeg: 5, pushKm: 0 }, -10, -99).pushKm, -CUT_PUSH_KM);
  assert.equal(moved({ facingDeg: 5, pushKm: 0 }, -10, 0).facingDeg, 355);
});
