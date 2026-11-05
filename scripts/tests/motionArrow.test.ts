import assert from "node:assert/strict";
import test from "node:test";
import {
  ARROW_SIZE, FASTEST_KMH, STALE_AFTER_S, STILL_KMH, arrowLength, arrowsStale, motionArrow, motionOf, roundDeg, roundKmh,
} from "../../src/lib/motionArrow.ts";
import type { ArrowShape, Point } from "../../src/lib/motionArrow.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const arrow = (east: number, north: number): ArrowShape => {
  const shape = motionArrow(east, north);
  assert.ok(shape);
  return shape;
};
const tip = (shape: ArrowShape): Point => shape.head[0];
const tail = (shape: ArrowShape): Point => shape.shaft[0];

test("a motion east and north is a speed and the direction the rain goes", () => {
  const east = motionOf(40, 0);
  close(east.kmh, 40);
  close(east.towardDeg, 90);
  close(motionOf(0, 30).towardDeg, 0);
  close(motionOf(0, -30).towardDeg, 180);
  close(motionOf(-30, 0).towardDeg, 270);
  close(motionOf(30, 30).kmh, Math.hypot(30, 30));
});

test("speeds are kept to the nearest 5 km/h and directions to the nearest 5 degrees", () => {
  assert.equal(roundKmh(37.4), 35);
  assert.equal(roundKmh(37.5), 40);
  assert.equal(roundDeg(2.4), 0);
  assert.equal(roundDeg(357.6), 0);
  assert.equal(roundDeg(-3), 355);
});

test("rain too slow to have a direction has no arrow", () => {
  assert.equal(motionArrow(2, 1), null);
  assert.equal(motionArrow(0, 0), null);
  assert.ok(motionArrow(STILL_KMH, 0));
});

test("the arrow points the way the rain goes: up the screen for rain going north", () => {
  const north = arrow(0, 40);
  close(tip(north)[0], 0);
  assert.ok(tip(north)[1] < 0);
  assert.ok(tail(north)[1] > 0);

  const east = arrow(40, 0);
  assert.ok(tip(east)[0] > 0);
  close(tip(east)[1], 0);
});

test("the arrow is centred on its block", () => {
  const shape = arrow(30, -20);
  close(tip(shape)[0] + tail(shape)[0], 0);
  close(tip(shape)[1] + tail(shape)[1], 0);
});

test("a faster motion is a longer arrow, up to the longest", () => {
  const length = (shape: ArrowShape) => Math.hypot(tip(shape)[0] - tail(shape)[0], tip(shape)[1] - tail(shape)[1]);
  close(length(arrow(STILL_KMH, 0)), ARROW_SIZE.shortest);
  assert.ok(length(arrow(60, 0)) > length(arrow(30, 0)));
  close(length(arrow(FASTEST_KMH, 0)), ARROW_SIZE.longest);
  close(length(arrow(3 * FASTEST_KMH, 0)), ARROW_SIZE.longest);
  close(arrowLength(0), ARROW_SIZE.shortest);
});

test("the head sits at the tip, as wide either side of the shaft", () => {
  const shape = arrow(0, 50);
  const [, left, right] = shape.head;
  close(left[1], right[1]);
  close(left[0], -right[0]);
  close(Math.abs(left[0]), ARROW_SIZE.halfWidth);
  assert.deepEqual(shape.shaft[1], [0, left[1]]);
});

test("the arrows are the motion of a forecast frame, and of an observed one shortly before them", () => {
  const arrows = 1_700_000_000;
  assert.equal(arrowsStale(arrows + 30 * 60, arrows, true), false);
  assert.equal(arrowsStale(arrows - 10 * 60, arrows, false), false);
  assert.equal(arrowsStale(arrows - STALE_AFTER_S, arrows, false), false);
});

test("the arrows are not the motion of an observed frame well before them", () => {
  const arrows = 1_700_000_000;
  assert.equal(arrowsStale(arrows - STALE_AFTER_S - 1, arrows, false), true);
  assert.equal(arrowsStale(arrows - 2 * 3600, arrows, false), true);
});

test("with no frame or no arrows yet, nothing is stale", () => {
  assert.equal(arrowsStale(null, 1_700_000_000, false), false);
  assert.equal(arrowsStale(1_700_000_000, null, false), false);
});
