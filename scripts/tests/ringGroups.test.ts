import assert from "node:assert/strict";
import test from "node:test";
import { groupRings } from "../../src/lib/ringGroups.ts";

test("rings are grouped by the counts given, in order", () => {
  assert.deepEqual(groupRings(["dwd", "dk", "dk-hole", "dk-island", "se"], [1, 3, 1]), [
    ["dwd"], ["dk", "dk-hole", "dk-island"], ["se"],
  ]);
});

test("rings past the counts are a group each", () => {
  assert.deepEqual(groupRings(["a", "b", "c"], [1]), [["a"], ["b"], ["c"]]);
  assert.deepEqual(groupRings(["a", "b"], []), [["a"], ["b"]]);
});

test("counts past the rings group nothing more", () => {
  assert.deepEqual(groupRings(["a", "b"], [2, 4]), [["a", "b"]]);
});
