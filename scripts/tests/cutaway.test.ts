import assert from "node:assert/strict";
import test from "node:test";
import { cutLabel, cutSnapLabels, normaliseCut } from "../../src/lib/cutAngle.ts";

test("a slice angle folds into a single turn", () => {
  assert.equal(normaliseCut(0), 0);
  assert.equal(normaliseCut(360), 0);
  assert.equal(normaliseCut(190), -170);
  assert.equal(normaliseCut(-190), 170);
  assert.equal(normaliseCut(-180), -180);
});

test("half a turn is a different slice, not the same one", () => {
  // Same plane, other half of the storm kept -- the view from ahead of it.
  assert.notEqual(normaliseCut(0), normaliseCut(180));
});

test("the caption names the slice by its angle to the track", () => {
  assert.equal(cutLabel(0), "cut along the storm's track");
  assert.equal(cutLabel(90), "cut across the storm's track");
  assert.equal(cutLabel(-90), "cut across the storm's track");
  assert.equal(cutLabel(40), "cut 40° off the storm's track");
});

test("which half is kept does not change what the cut is called", () => {
  assert.equal(cutLabel(180), cutLabel(0));
  assert.equal(cutLabel(140), cutLabel(40));
});

test("a storm with no track is described against the compass, not a track", () => {
  // Saying "along the track" about a core found only in the composite would
  // claim a direction of travel nobody measured.
  assert.equal(cutLabel(0, "north"), "cut north to south");
  assert.equal(cutLabel(90, "north"), "cut east to west");
  assert.equal(cutLabel(30, "north"), "cut 30\u00b0 off north\u2013south");
  assert.ok(!cutLabel(0, "north").includes("track"));
});

test("the snap buttons name the axes the slice is measured from", () => {
  assert.deepEqual(cutSnapLabels("track"), ["along", "across"]);
  assert.deepEqual(cutSnapLabels("north"), ["N\u2013S", "E\u2013W"]);
});
