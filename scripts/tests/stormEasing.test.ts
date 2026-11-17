import assert from "node:assert/strict";
import test from "node:test";
import {
  EASE_MAX_KM, EASE_MIN_GAP_MS, animates, easeOut, eases, kmBetween, plan, settledOn, shapeAt, showingAt, slides,
} from "../../src/lib/stormEasing.ts";
import type { Drawn, Shape } from "../../src/lib/stormEasing.ts";

/**
 * How the storms change from one drawing to the next: which changes are
 * eased, what slides and what fades, and an update arriving mid-way taking
 * over from what is drawn rather than queueing behind it.
 */

const point = (lon: number, lat: number): Shape => ({ type: "Point", coordinates: [lon, lat] });
const line = (...coordinates: [number, number][]): Shape => ({ type: "LineString", coordinates });

const mark = (key: string, shape: Shape, look = "a"): Drawn<string> => ({
  key, look, moves: shape.type === "Point" || shape.type === "LineString", shape, value: key,
});

/** Where `key` is drawn, and how strongly, at `t` of a transition. */
const at = (easings: ReturnType<typeof plan<string>>, t: number) => showingAt(easings, t);
const byKey = (showing: ReturnType<typeof at>, key: string) => showing.find((shown) => shown.key === key);

/** About 1 km of longitude at 45° N. */
const KM = 1 / (111.32 * Math.cos((45 * Math.PI) / 180));

test("a new answer is eased, a step only when it comes long enough after the last, and nothing with reduced motion", () => {
  assert.equal(eases({ reducedMotion: false, drawnBefore: true }), true);
  assert.equal(eases({ reducedMotion: false, drawnBefore: true, stepGap: EASE_MIN_GAP_MS }), true);
  assert.equal(eases({ reducedMotion: false, drawnBefore: true, stepGap: Infinity }), true);
  // The loop's 450 ms a frame, and a drag.
  assert.equal(eases({ reducedMotion: false, drawnBefore: true, stepGap: 450 }), false);
  assert.equal(eases({ reducedMotion: false, drawnBefore: true, stepGap: 30 }), false);
  assert.equal(eases({ reducedMotion: true, drawnBefore: true }), false);
  // The first drawing appears at once.
  assert.equal(eases({ reducedMotion: false, drawnBefore: false }), false);
});

test("the easing starts fast and ends exactly where it was going", () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(2), 1);
  assert.ok(easeOut(0.25) > 0.5);
});

test("a storm that moved slides from where it was to where it is", () => {
  const before = settledOn([mark("S", point(4, 45))]);
  const easings = plan(at(before, 1), [mark("S", point(4 + 5 * KM, 45))], 1);
  assert.equal(easings.length, 1);
  assert.equal(animates(easings), true);
  const start = byKey(at(easings, 0), "S")!;
  assert.deepEqual(start.shape, point(4, 45));
  assert.equal(start.alpha, 1);
  const half = byKey(at(easings, 0.5), "S")!.shape as { coordinates: [number, number] };
  assert.ok(half.coordinates[0] > 4 && half.coordinates[0] < 4 + 5 * KM);
  assert.deepEqual(byKey(at(easings, 1), "S")!.shape, point(4 + 5 * KM, 45));
});

test("a storm that did not move is left alone, so nothing redraws it", () => {
  const before = settledOn([mark("S", point(4, 45))]);
  const easings = plan(at(before, 1), [mark("S", point(4, 45))], 1);
  assert.equal(animates(easings), false);
  assert.equal(easings[0].from, easings[0].to);
});

test("a storm that jumped further than a storm moves fades out there and in here", () => {
  const far = point(4 + (EASE_MAX_KM + 5) * KM, 45);
  assert.equal(slides(point(4, 45), far), false);
  const before = settledOn([mark("S", point(4, 45))]);
  const easings = plan(at(before, 1), [mark("S", far)], 7);
  const halfway = at(easings, 0.5);
  const leaving = byKey(halfway, "S~7")!;
  assert.equal(leaving.leaving, true);
  assert.deepEqual(leaving.shape, point(4, 45));
  assert.deepEqual(byKey(halfway, "S")!.shape, far);
  assert.ok(byKey(halfway, "S")!.alpha > 0 && byKey(halfway, "S")!.alpha < 1);
  // Gone once it ends.
  assert.deepEqual(at(easings, 1).map((shown) => shown.key), ["S"]);
});

test("a different storm at nearly the same place fades, it does not slide", () => {
  const before = settledOn([mark("A", point(4, 45))]);
  const easings = plan(at(before, 1), [mark("B", point(4 + 0.1 * KM, 45))], 1);
  const start = at(easings, 0);
  assert.equal(byKey(start, "B")!.alpha, 0);
  assert.deepEqual(byKey(start, "B")!.shape, point(4 + 0.1 * KM, 45));
  assert.equal(byKey(start, "A~1")!.alpha, 1);
  assert.equal(byKey(start, "A~1")!.leaving, true);
  assert.deepEqual(at(easings, 1).map((shown) => shown.key), ["B"]);
});

test("a storm that appears fades in, and one that goes fades out and is gone", () => {
  const before = settledOn([mark("OLD", point(4, 45))]);
  const easings = plan(at(before, 1), [mark("NEW", point(5, 45))], 2);
  assert.equal(byKey(at(easings, 0), "NEW")!.alpha, 0);
  assert.equal(byKey(at(easings, 0), "OLD~2")!.alpha, 1);
  assert.equal(byKey(at(easings, 1), "NEW")!.alpha, 1);
  assert.equal(byKey(at(easings, 1), "OLD~2"), undefined);
});

test("a storm that changes look cross-fades, both looks moving together", () => {
  const before = settledOn([mark("S", point(4, 45), "quiet")]);
  const to = point(4 + 3 * KM, 45);
  const easings = plan(at(before, 1), [mark("S", to, "full")], 3);
  const half = at(easings, 0.5);
  const oldLook = byKey(half, "S~3")!;
  const newLook = byKey(half, "S")!;
  assert.equal(oldLook.item.look, "quiet");
  assert.equal(newLook.item.look, "full");
  assert.deepEqual(oldLook.shape, newLook.shape);
  assert.ok(Math.abs(oldLook.alpha + newLook.alpha - 1) < 1e-9);
  assert.deepEqual(at(easings, 1).map((shown) => [shown.key, shown.item.look]), [["S", "full"]]);
});

test("a path keeps its points and grows its newest one to where the storm is", () => {
  const from = line([4, 45], [4.01, 45]);
  const to = line([4, 45], [4.01, 45], [4.03, 45]);
  assert.deepEqual(shapeAt(from, to, 0), line([4, 45], [4.01, 45], [4.01, 45]));
  assert.deepEqual(shapeAt(from, to, 1), to);
  const half = shapeAt(from, to, 0.5) as { coordinates: [number, number][] };
  assert.ok(Math.abs(half.coordinates[2][0] - 4.02) < 1e-9);
});

test("an outline with a new shape cross-fades rather than morphing", () => {
  const square = (size: number): Shape => ({
    type: "MultiPolygon", coordinates: [[[[4, 45], [4 + size, 45], [4 + size, 45 + size], [4, 45 + size], [4, 45]]]],
  });
  const outline = (shape: Shape): Drawn<string> => ({ key: "G", look: "", moves: false, shape, value: "G" });
  const before = settledOn([outline(square(0.1))]);
  const easings = plan(at(before, 1), [outline(square(0.2))], 4);
  const half = at(easings, 0.5);
  assert.deepEqual(byKey(half, "G~4")!.shape, square(0.1));
  assert.deepEqual(byKey(half, "G")!.shape, square(0.2));
  // The same shape again: nothing to do.
  assert.equal(animates(plan(at(settledOn([outline(square(0.1))]), 1), [outline(square(0.1))], 5)), false);
});

test("an update mid-way takes over from where the storm is drawn, never from where it was going", () => {
  const before = settledOn([mark("S", point(4, 45))]);
  const first = plan(at(before, 1), [mark("S", point(4 + 4 * KM, 45))], 1);
  const midway = at(first, 0.3);
  const drawn = (byKey(midway, "S")!.shape as { coordinates: [number, number] }).coordinates;
  const second = plan(midway, [mark("S", point(4 + 8 * KM, 45))], 2);
  assert.equal(second.length, 1);
  assert.deepEqual(byKey(at(second, 0), "S")!.shape, point(...drawn));
  assert.deepEqual(byKey(at(second, 1), "S")!.shape, point(4 + 8 * KM, 45));
});

test("what was fading out goes on fading out from where it was, and leaves nothing behind", () => {
  const before = settledOn([mark("GONE", point(4, 45)), mark("NEW", point(5, 45))]);
  const first = plan(at(before, 1), [mark("NEW", point(5, 45))], 1);
  const midway = at(first, 0.5);
  const fading = byKey(midway, "GONE~1")!;
  assert.ok(fading.alpha > 0 && fading.alpha < 1);
  const second = plan(midway, [mark("NEW", point(5, 45))], 2);
  // The same leaving mark, under its own key, from its own alpha: not a second ghost.
  assert.deepEqual(second.filter((easing) => easing.leaving).map((easing) => [easing.key, easing.fromAlpha]), [["GONE~1", fading.alpha]]);
  assert.deepEqual(at(second, 1).map((shown) => shown.key), ["NEW"]);
});

test("a storm fading in takes over from its own alpha, and one coming back while leaving comes in afresh", () => {
  const first = plan([], [mark("S", point(4, 45))], 1);
  const midway = at(first, 0.2);
  const alpha = byKey(midway, "S")!.alpha;
  const second = plan(midway, [mark("S", point(4, 45))], 2);
  assert.equal(second[0].fromAlpha, alpha);
  assert.equal(second[0].toAlpha, 1);

  const leaving = at(plan(at(settledOn([mark("S", point(4, 45))]), 1), [], 3), 0.5);
  const back = plan(leaving, [mark("S", point(4, 45))], 4);
  assert.equal(byKey(at(back, 0), "S")!.alpha, 0);
  assert.equal(byKey(at(back, 1), "S")!.alpha, 1);
  assert.equal(at(back, 1).length, 1);
});

test("an update applied at once replaces whatever was running, leaving nothing", () => {
  const first = plan(at(settledOn([mark("A", point(4, 45))]), 1), [mark("B", point(5, 45))], 1);
  assert.ok(at(first, 0.5).some((shown) => shown.leaving));
  const snapped = settledOn([mark("C", point(6, 45))]);
  assert.equal(animates(snapped), false);
  assert.deepEqual(at(snapped, 0).map((shown) => [shown.key, shown.alpha]), [["C", 1]]);
});

test("distances are kilometres", () => {
  assert.ok(Math.abs(kmBetween([4, 45], [4 + 10 * KM, 45]) - 10) < 1e-6);
});
