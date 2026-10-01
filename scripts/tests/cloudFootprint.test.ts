import assert from "node:assert/strict";
import test from "node:test";
import { BOX_KM, boxFootprint } from "../../src/lib/cloudFootprint.ts";

/** Kilometres per degree on MapLibre's sphere. */
const KM_PER_DEG = (2 * Math.PI * 6371.0088) / 360;

/** Kilometres east and north of `from` to `to`, near enough at these distances. */
function offsetKm(from: [number, number], to: [number, number]): [number, number] {
  const midLat = ((from[1] + to[1]) / 2) * (Math.PI / 180);
  return [(to[0] - from[0]) * KM_PER_DEG * Math.cos(midLat), (to[1] - from[1]) * KM_PER_DEG];
}

test("the outline is the box: 40 km a side, centred on the core, north up", () => {
  const { ring } = boxFootprint(7.75, 48.58);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  const [sw, se, ne, nw] = ring;
  const [east] = offsetKm(sw, se);
  const [, north] = offsetKm(sw, nw);
  assert.ok(Math.abs(east - BOX_KM) < 0.2, `east side ${east}`);
  assert.ok(Math.abs(north - BOX_KM) < 0.2, `north side ${north}`);
  // A square on the map, not a trapezoid: the box is placed in Mercator.
  assert.ok(Math.abs(se[0] - ne[0]) < 1e-12 && Math.abs(sw[0] - nw[0]) < 1e-12);
  const [cx, cy] = offsetKm([7.75, 48.58], [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2]);
  assert.ok(Math.hypot(cx, cy) < 0.05);
});

test("a loaded box says its own size", () => {
  const [sw, se, , nw] = boxFootprint(10, 52, [30_000, 20_000]).ring;
  assert.ok(Math.abs(offsetKm(sw, se)[0] - 30) < 0.2);
  assert.ok(Math.abs(offsetKm(sw, nw)[1] - 20) < 0.2);
});

test("the spin axis stands on the storm, which the box's centre stands in for until it is known", () => {
  assert.deepEqual(boxFootprint(7.75, 48.58).pivot.map((v) => v.toFixed(9)), ["7.750000000", "48.580000000"]);
  const [east, north] = offsetKm([7.75, 48.58], boxFootprint(7.75, 48.58, undefined, [5, -3]).pivot);
  assert.ok(Math.abs(east - 5) < 0.05, `east ${east}`);
  assert.ok(Math.abs(north + 3) < 0.05, `north ${north}`);
});
