import assert from "node:assert/strict";
import test from "node:test";
import { isSuccessor } from "../../src/lib/cloudSuccession.ts";
import type { Cutaway } from "../../src/lib/cellCutaway.ts";

/** Just the fields the footprint reads. */
const storm = (lon: number, lat: number, half: [number, number], centre: [number, number] = [0, 0]) => ({
  header: { lon, lat },
  centreKm: [...centre, 0],
  halfKm: [...half, 4],
}) as unknown as Cutaway;

test("the same storm five minutes on is its successor", () => {
  // Demo's German Bight core at 04:15 and 04:20: a kilometre apart, new code.
  const earlier = storm(9.71087, 54.40429, [19.875, 19.875]);
  const later = storm(9.71080, 54.41302, [19.875, 19.875]);
  assert.ok(isSuccessor(earlier, later));
});

test("a small shower that drifted most of its width is still its successor", () => {
  const earlier = storm(9, 54, [3, 3]);
  // About 3.3 km east: under half its own 6 km width left in common.
  const later = storm(9.05, 54, [3, 3]);
  assert.ok(isSuccessor(earlier, later));
});

test("a neighbour whose edge brushes the storm is a different storm", () => {
  const earlier = storm(9, 54, [10, 10]);
  // 18 km east with a 10 km half-width: two km of shared ground in twenty.
  const neighbour = storm(9 + 18 / (111.32 * Math.cos((54 * Math.PI) / 180)), 54, [10, 10]);
  assert.ok(!isSuccessor(earlier, neighbour));
});

test("the storm's echo decides, not the box's centre", () => {
  // Two boxes 30 km apart whose storms both sit towards the middle.
  const dx = 30 / (111.32 * Math.cos((54 * Math.PI) / 180));
  const earlier = storm(9, 54, [5, 5], [14, 0]);
  const later = storm(9 + dx, 54, [5, 5], [-15, 0]);
  assert.ok(isSuccessor(earlier, later));
  assert.ok(!isSuccessor(storm(9, 54, [5, 5]), storm(9 + dx, 54, [5, 5])));
});
