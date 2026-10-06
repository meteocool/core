import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PRODUCT, FALLBACK_BEHIND_S, ageMinutes, drawnProduct, fallsBehind, parseObservedProduct, stepFrame,
} from "../../src/lib/observedProduct.ts";
import type { NewestScans } from "../../src/lib/observedProduct.ts";

/**
 * Which picture the radar map draws, and when it quietly draws the default
 * instead. What the reader picked has to hold as long as it is worth looking
 * at -- DMAX is always a cycle behind HX, and that alone must not undo the
 * choice -- and give way once its feed has stalled.
 */

const T = 1_791_240_000;
const MIN = 60;

const scans = (hx: number | null, merged: number | null, dmax: number | null): NewestScans => ({ hx, merged, dmax });

test("the default is never behind, even with nothing to draw", () => {
  assert.equal(fallsBehind("hx", scans(null, T, T)), false);
  assert.equal(drawnProduct("hx", scans(null, null, null)), "hx");
});

test("DMAX a cycle behind HX, as it always is, is drawn", () => {
  assert.equal(drawnProduct("dmax", scans(T, T, T - 5 * MIN)), "dmax");
});

test("DMAX two cycles behind, one skipped, is still drawn", () => {
  assert.equal(drawnProduct("dmax", scans(T, T, T - FALLBACK_BEHIND_S)), "dmax");
});

test("DMAX three cycles behind gives way to the default", () => {
  assert.equal(drawnProduct("dmax", scans(T, T, T - 15 * MIN)), DEFAULT_PRODUCT);
});

test("a product with nothing fresh gives way to the default", () => {
  assert.equal(drawnProduct("merged", scans(T, null, T)), DEFAULT_PRODUCT);
  assert.equal(drawnProduct("dmax", scans(T, T, null)), DEFAULT_PRODUCT);
});

test("before HX is known there is nothing to trail, and a fresh choice is drawn", () => {
  assert.equal(drawnProduct("dmax", scans(null, null, T - 40 * MIN)), "dmax");
});

test("a merged composite ahead of HX is drawn", () => {
  assert.equal(drawnProduct("merged", scans(T, T + 2 * MIN, null)), "merged");
});

test("a setting that names no product is the default", () => {
  assert.equal(parseObservedProduct("dmax"), "dmax");
  assert.equal(parseObservedProduct("merged"), "merged");
  assert.equal(parseObservedProduct("eu"), "hx");
  assert.equal(parseObservedProduct(true), "hx");
  assert.equal(parseObservedProduct(null), "hx");
});

const history = { [T - 300]: "dmax-1", [T - 600]: "dmax-2" };

test("only the drawn product stands in for the default", () => {
  const step = { observed: true, live: false, key: T - 300 };
  assert.equal(stepFrame("dmax", "dmax", step, history, null), "dmax-1");
  assert.equal(stepFrame("dmax", "hx", step, history, null), null);
  assert.equal(stepFrame("merged", "dmax", step, history, null), null);
});

test("a forecast step is WN's whatever was chosen", () => {
  assert.equal(stepFrame("dmax", "dmax", { observed: false, live: false, key: T - 300 }, history, "live"), null);
});

test("the live step draws the product's own newest frame", () => {
  const live = { observed: true, live: true, key: T };
  assert.equal(stepFrame("dmax", "dmax", live, history, "newest"), "newest");
  assert.equal(stepFrame("dmax", "dmax", live, { [T]: "matched" }, null), "matched", "until the live frame lands");
});

test("a step the product has no frame for shows the default", () => {
  assert.equal(stepFrame("dmax", "dmax", { observed: true, live: false, key: T - 900 }, history, "newest"), null);
});

test("an age is whole minutes, never negative", () => {
  assert.equal(ageMinutes(T - 7 * MIN - 59, T), 7);
  assert.equal(ageMinutes(T + 30, T), 0);
  assert.equal(ageMinutes(null, T), null);
});
