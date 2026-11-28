import assert from "node:assert/strict";
import { test } from "node:test";
import { pointGrid, POINTS_MAX, pointStride } from "../../src/layers/cloudPoints.ts";

const WHOLE = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };

test("the grid is thinned by powers of two until its dots stand half as far apart as they are drawn", () => {
  assert.equal(pointStride(12), 1);
  assert.equal(pointStride(1.75), 1);
  assert.equal(pointStride(1), 2);
  assert.equal(pointStride(0.5), 4);
  assert.equal(pointStride(0.1), 8);
  // Behind the eye or not on screen at all: as coarse as it gets.
  assert.equal(pointStride(0), 8);
  assert.equal(pointStride(Number.NaN), 8);
});

test("a grid covers the drawn part of its box, from a multiple of its stride", () => {
  const grid = pointGrid([104, 104, 32], { min: [0.1, 0, 0], max: [0.5, 1, 0.5] }, 4, [2, 2, 2]);
  assert.deepEqual(grid.start, [8, 0, 0]);
  // Upwards a quarter as coarse: every level, here.
  assert.deepEqual(grid.count, [11, 26, 16]);
  assert.equal(grid.total, 11 * 26 * 16);
  assert.deepEqual(grid.stride, [4, 4, 1]);
  assert.deepEqual(pointGrid([104, 104, 32], WHOLE, 8, [2, 2, 2]).stride, [8, 8, 2]);
});

test("each axis is walked from the end the eye is further from", () => {
  assert.deepEqual(pointGrid([8, 8, 8], WHOLE, 1, [2, 2, 2]).flip, [0, 0, 0]);
  assert.deepEqual(pointGrid([8, 8, 8], WHOLE, 1, [-1, 2, 0.2]).flip, [1, 0, 1]);
});

test("a box of more dots than one tile is drawn as is thinned further", () => {
  const grid = pointGrid([160, 160, 64], WHOLE, 1, [2, 2, 2]);
  assert.ok(grid.stride[0] > 1);
  assert.ok(grid.total <= POINTS_MAX);
  // And no further than the coarsest, however large.
  assert.equal(pointGrid([4000, 4000, 64], WHOLE, 1, [2, 2, 2]).stride[0], 8);
});

test("a box with nothing in it has no dots", () => {
  assert.equal(pointGrid([104, 104, 32], { min: [0.5, 0.5, 0.5], max: [0.5, 0.5, 0.5] }, 1, [2, 2, 2]).total, 0);
});
