import assert from "node:assert/strict";
import test from "node:test";
import { cutLabel, normaliseCut } from "../../src/lib/cutAngle.ts";

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
