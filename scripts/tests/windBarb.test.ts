import assert from "node:assert/strict";
import test from "node:test";
import { BARB_SIZE, roundKnots, toKnots, windBarb } from "../../src/lib/windBarb.ts";
import type { BarbShape, Point } from "../../src/lib/windBarb.ts";

const barb = (knots: number, from = 270) => {
  const shape = windBarb(knots, from);
  assert.equal(shape.kind, "barb");
  return shape as Extract<BarbShape, { kind: "barb" }>;
};
const length = ([a, b]: [Point, Point]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** How far in from the shaft's far end a point on it is. */
const inFromEnd = (shape: Extract<BarbShape, { kind: "barb" }>, point: Point) => length([point, shape.shaft[1]]);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("metres per second become knots", () => {
  close(toKnots(1), 1.943844);
  close(toKnots(10), 19.43844);
});

test("the speed is rounded to the nearest 5 kt", () => {
  assert.equal(roundKnots(7.4), 5);
  assert.equal(roundKnots(7.5), 10);
  assert.equal(roundKnots(12.4), 10);
  assert.equal(roundKnots(0), 0);
});

test("below 2.5 kt it is calm: an open circle and no shaft", () => {
  assert.deepEqual(windBarb(0, 270), { kind: "calm", radius: BARB_SIZE.calm });
  assert.deepEqual(windBarb(2.4, 90), { kind: "calm", radius: BARB_SIZE.calm });
  assert.equal(windBarb(2.5, 90).kind, "barb");
});

test("5 kt is a lone half feather, one step in from the end", () => {
  const shape = barb(5);
  assert.equal(shape.pennants.length, 0);
  assert.equal(shape.feathers.length, 1);
  close(length(shape.feathers[0]) / Math.hypot(1, 0.45), BARB_SIZE.feather / 2);
  close(inFromEnd(shape, shape.feathers[0][0]), BARB_SIZE.step);
});

test("10 kt is one full feather, at the end", () => {
  const shape = barb(10);
  assert.equal(shape.feathers.length, 1);
  close(length(shape.feathers[0]) / Math.hypot(1, 0.45), BARB_SIZE.feather);
  close(inFromEnd(shape, shape.feathers[0][0]), 0);
});

test("15 kt is a full feather at the end and a half one a step in", () => {
  const shape = barb(15);
  assert.equal(shape.feathers.length, 2);
  const [full, half] = shape.feathers;
  close(inFromEnd(shape, full[0]), 0);
  close(inFromEnd(shape, half[0]), BARB_SIZE.step);
  assert.ok(length(half) < length(full));
});

test("50 kt is one pennant and nothing else", () => {
  const shape = barb(50);
  assert.equal(shape.pennants.length, 1);
  assert.equal(shape.feathers.length, 0);
  close(inFromEnd(shape, shape.pennants[0][0]), 0);
  close(inFromEnd(shape, shape.pennants[0][1]), BARB_SIZE.pennant);
});

test("65 kt is a pennant first, then a full feather, then a half", () => {
  const shape = barb(65);
  assert.equal(shape.pennants.length, 1);
  assert.equal(shape.feathers.length, 2);
  const [full, half] = shape.feathers;
  assert.ok(inFromEnd(shape, full[0]) > BARB_SIZE.pennant);
  close(inFromEnd(shape, half[0]) - inFromEnd(shape, full[0]), BARB_SIZE.step);
  assert.ok(length(half) < length(full));
});

test("100 kt and more are two pennants, and the shaft grows to carry what does not fit", () => {
  assert.equal(barb(100).pennants.length, 2);
  assert.equal(barb(100).feathers.length, 0);
  const strong = barb(145);
  assert.equal(strong.pennants.length, 2);
  assert.equal(strong.feathers.length, 5);
  const innermost = Math.max(...strong.feathers.map((feather) => inFromEnd(strong, feather[0])));
  assert.ok(length(strong.shaft) - innermost >= BARB_SIZE.step * 2 - 1e-9);
});

test("the shaft points to where the wind comes from: N up, E right, S down, W left", () => {
  const end = (from: number) => barb(10, from).shaft[1].map((value) => Math.round(value) + 0);
  assert.deepEqual(barb(10, 0).shaft[0], [0, 0]);
  assert.deepEqual(end(0), [0, -BARB_SIZE.shaft]);
  assert.deepEqual(end(90), [BARB_SIZE.shaft, 0]);
  assert.deepEqual(end(180), [0, BARB_SIZE.shaft]);
  assert.deepEqual(end(270), [-BARB_SIZE.shaft, 0]);
});

test("a westerly's feathers stand up towards the north", () => {
  for (const [base, tip] of barb(25, 270).feathers) assert.ok(tip[1] < base[1] - 5, `${tip} not north of ${base}`);
  for (const [, , apex] of barb(50, 270).pennants) assert.ok(apex[1] < -5);
});

test("a northerly's feathers stand out to the east", () => {
  for (const [base, tip] of barb(25, 0).feathers) assert.ok(tip[0] > base[0] + 5, `${tip} not east of ${base}`);
});

test("feathers lean out towards the shaft's far end", () => {
  // A westerly's shaft runs west, so outwards is further west.
  for (const [base, tip] of barb(20, 270).feathers) assert.ok(tip[0] < base[0]);
});
