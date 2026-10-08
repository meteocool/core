import assert from "node:assert/strict";
import test from "node:test";
import { cutLabel, cutSnapLabels, normaliseCut } from "../../src/lib/cutAngle.ts";
import type { Translate } from "../../src/locale/t.ts";

/** Names the message and what was put into it, so the tests see both. */
const t: Translate = (key, options) => (
  options?.values
    ? `${key}(${Object.entries(options.values).map(([name, value]) => `${name}=${value}`).join(",")})`
    : key
);

test("a slice angle folds into a single turn", () => {
  assert.equal(normaliseCut(0), 0);
  assert.equal(normaliseCut(360), 0);
  assert.equal(normaliseCut(190), -170);
  assert.equal(normaliseCut(-190), 170);
  assert.equal(normaliseCut(-180), -180);
});

test("half a turn is a different slice, not the same one", () => {
  // Same plane, other half of the storm kept: the view from ahead of it.
  assert.notEqual(normaliseCut(0), normaliseCut(180));
});

test("the caption names the slice by its angle to the track", () => {
  assert.equal(cutLabel(0, t), "storm.cut.along");
  assert.equal(cutLabel(90, t), "storm.cut.across");
  assert.equal(cutLabel(-90, t), "storm.cut.across");
  assert.equal(cutLabel(40, t), "storm.cut.off_track(deg=40)");
});

test("which half is kept does not change what the cut is called", () => {
  assert.equal(cutLabel(180, t), cutLabel(0, t));
  assert.equal(cutLabel(140, t), cutLabel(40, t));
});

test("a storm with no track is described against the compass, not a track", () => {
  // Saying "along the track" about a core found only in the composite would
  // claim a direction of travel nobody measured.
  assert.equal(cutLabel(0, t, "north"), "storm.cut.north_south");
  assert.equal(cutLabel(90, t, "north"), "storm.cut.east_west");
  assert.equal(cutLabel(30, t, "north"), "storm.cut.off_north(deg=30)");
  assert.ok(!cutLabel(0, t, "north").includes("track"));
});

test("the snap buttons name the axes the slice is measured from", () => {
  assert.deepEqual(cutSnapLabels("track", t), ["storm.cut.snap_along", "storm.cut.snap_across"]);
  assert.deepEqual(cutSnapLabels("north", t), ["storm.cut.snap_ns", "storm.cut.snap_ew"]);
});
