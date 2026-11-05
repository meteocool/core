import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PRODUCT, FALLBACK_BEHIND_S, OBSERVED_PRODUCTS, PRODUCT_GROUPS, WHOLE_PRODUCTS, ageMinutes, ageSpan, aroundFrame,
  drawnProduct, givesUpChoice, fallsBehind, isWholeProduct, scanRange, parseObservedProduct, stepFrame, timeseriesProducts,
} from "../../src/lib/observedProduct.ts";
import type { ColumnProduct, NewestScans } from "../../src/lib/observedProduct.ts";

/**
 * Which picture the radar map draws, and when it quietly draws the default
 * instead. What the reader picked has to hold as long as it is worth looking
 * at (DMAX is always a cycle behind HX, and that alone must not undo the
 * choice) and give way once its feed has stalled.
 */

const T = 1_791_240_000;
const MIN = 60;

const scans = (hx: number | null, merged: number | null, dmax: number | null, colmax: number | null = null): NewestScans => ({
  hx, merged, colmax, dmax, echotop18: null, echotop45: null, echotop50: null, vil: null,
});

/** What the column maximum's pass reads up the column besides it. */
const COLUMN_PRODUCTS: ColumnProduct[] = ["echotop18", "echotop45", "echotop50", "vil"];

/** HX at `hx`, and every product of the column maximum's pass at `pass`. */
const pass = (hx: number | null, at: number | null): NewestScans => ({
  ...scans(hx, hx, hx, at), echotop18: at, echotop45: at, echotop50: at, vil: at,
});

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

test("the column maximum of every network, two cycles behind as it is for a minute of every five, is drawn", () => {
  assert.equal(drawnProduct("colmax", scans(T, T, T, T - 10 * MIN)), "colmax");
});

test("the column maximum three cycles behind, one pass late, is still drawn; four gives way", () => {
  assert.equal(drawnProduct("colmax", scans(T, T, T, T - 15 * MIN)), "colmax");
  assert.equal(drawnProduct("colmax", scans(T, T, T, T - 20 * MIN)), DEFAULT_PRODUCT);
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

test("the echo tops and VIL trail HX as far as the column maximum they are built with, and no further", () => {
  for (const product of COLUMN_PRODUCTS) {
    assert.equal(drawnProduct(product, pass(T, T - 10 * MIN)), product, `${product} two cycles behind`);
    assert.equal(drawnProduct(product, pass(T, T - 15 * MIN)), product, `${product} three cycles behind`);
    assert.equal(drawnProduct(product, pass(T, T - 20 * MIN)), DEFAULT_PRODUCT, `${product} four cycles behind`);
    assert.equal(drawnProduct(product, pass(T, null)), DEFAULT_PRODUCT, `${product} with nothing`);
  }
});

test("each of the pass's products is judged by its own scan, not the column maximum's", () => {
  const onlyColmax = { ...pass(T, null), colmax: T - 5 * MIN };
  assert.equal(drawnProduct("colmax", onlyColmax), "colmax");
  assert.equal(drawnProduct("echotop18", onlyColmax), DEFAULT_PRODUCT);
  assert.equal(drawnProduct("vil", { ...onlyColmax, vil: T - 5 * MIN }), "vil");
});

test("a setting that names no product is the default", () => {
  assert.equal(parseObservedProduct("dmax"), "dmax");
  assert.equal(parseObservedProduct("merged"), "merged");
  assert.equal(parseObservedProduct("colmax"), "colmax");
  for (const product of COLUMN_PRODUCTS) assert.equal(parseObservedProduct(product), product);
  assert.equal(parseObservedProduct("echotop"), "hx");
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

test("HX and DMAX run from their freshest country to their stalest", () => {
  assert.deepEqual(scanRange("hx", 1_000, [940, 700], null), [1_000, 700]);
  // A neighbour out before HX is the fresh end.
  assert.deepEqual(scanRange("hx", 1_000, [1_060, 700], null), [1_060, 700]);
  assert.deepEqual(scanRange("dmax", 1_000, [1_060], null), [1_060, 1_000]);
  assert.equal(scanRange("hx", null, [700], null), null);
});

test("DMAX with the column maximum around it spans the two, not the networks", () => {
  assert.deepEqual(scanRange("dmax", 1_000, [400], 700), [1_000, 700]);
  assert.deepEqual(scanRange("dmax", 1_000, [400], 1_100), [1_100, 1_000]);
  // HX keeps its networks whatever is passed for DMAX.
  assert.deepEqual(scanRange("hx", 1_000, [400], 700), [1_000, 400]);
});

test("the merged products are one frame, stamped with their own newest scan", () => {
  assert.deepEqual(scanRange("merged", 1_000, [1_200, 700], null), [1_000, 1_000]);
  assert.deepEqual(scanRange("colmax", 1_000, [700], 600), [1_000, 1_000]);
  for (const product of COLUMN_PRODUCTS) {
    assert.deepEqual(scanRange(product, 1_000, [1_200, 700], null), [1_000, 1_000], product);
    assert.equal(scanRange(product, null, [1_200], null), null, product);
  }
});

test("an age span runs from the freshest part to the stalest", () => {
  assert.deepEqual(ageSpan([1_000, 700], 1_200), [3, 8]);
  assert.deepEqual(ageSpan([1_000, 1_000], 1_200), [3, 3]);
  assert.equal(ageSpan(null, 1_200), null);
});

test("DMAX asks for the column maximum's past too, to draw around it", () => {
  assert.deepEqual(timeseriesProducts("hx"), []);
  assert.deepEqual(timeseriesProducts("dmax"), ["dmax", "colmax"]);
  assert.deepEqual(timeseriesProducts("merged"), ["merged"]);
  assert.deepEqual(timeseriesProducts("colmax"), ["colmax"]);
});

test("an echo top or VIL asks for its own past alone, not the column maximum's", () => {
  for (const product of COLUMN_PRODUCTS) assert.deepEqual(timeseriesProducts(product), [product]);
});

test("the column maximum is drawn around DMAX only, and only where it has a frame", () => {
  const fresh: NewestScans = { ...pass(1_000, 700), merged: 1_000, dmax: 900 };
  const live = { observed: true, live: true, key: 1_000 };
  const past = { observed: true, live: false, key: 400 };
  assert.equal(aroundFrame("dmax", live, {}, "newest", fresh), "newest");
  assert.equal(aroundFrame("hx", live, {}, "newest", fresh), null);
  assert.equal(aroundFrame("colmax", live, {}, "newest", fresh), null);
  for (const product of COLUMN_PRODUCTS) assert.equal(aroundFrame(product, live, {}, "newest", fresh), null, product);
  assert.equal(aroundFrame("dmax", past, { 400: "then" }, "newest", fresh), "then");
  // A step it has no frame for has the networks around DMAX instead.
  assert.equal(aroundFrame("dmax", past, {}, "newest", fresh), null);
  // Too far behind on the live step, and the networks stand in there too.
  assert.equal(aroundFrame("dmax", live, {}, "newest", { ...fresh, colmax: 1_000 - 30 * 60 }), null);
});

test("an EU product with no frame at all is given up, once its feed has answered", () => {
  const none: NewestScans = scans(1_000, null, null, null);
  assert.ok(givesUpChoice("merged", none, true));
  assert.ok(givesUpChoice("colmax", none, true));
  for (const product of COLUMN_PRODUCTS) {
    assert.ok(givesUpChoice(product, none, true), product);
    assert.ok(!givesUpChoice(product, none, false), product);
    assert.ok(!givesUpChoice(product, { ...none, [product]: 1_000 - 60 * 60 }, true), `${product} merely behind`);
  }
  // Not before the answer: every product has nothing while the page loads.
  assert.ok(!givesUpChoice("merged", none, false));
  // Not DMAX, and not the default.
  assert.ok(!givesUpChoice("dmax", none, true));
  assert.ok(!givesUpChoice("hx", none, true));
  // Merely behind is the default standing in, not a choice given up.
  assert.ok(!givesUpChoice("merged", { ...none, merged: 1_000 - 60 * 60 }, true));
});

test("the picker lists every product once: the lowest scans, the column maxima, then the echo tops upward and VIL", () => {
  assert.deepEqual(PRODUCT_GROUPS.map(({ group }) => group), ["lowest", "column", "tops"]);
  assert.deepEqual(PRODUCT_GROUPS[2].products, ["echotop18", "echotop45", "echotop50", "vil"]);
  assert.equal(new Set(OBSERVED_PRODUCTS).size, OBSERVED_PRODUCTS.length);
  assert.equal(OBSERVED_PRODUCTS.length, 8);
  assert.equal(OBSERVED_PRODUCTS[0], DEFAULT_PRODUCT);
});

test("every product of every network is drawn whole; HX and DMAX keep DWD's grid", () => {
  assert.deepEqual([...WHOLE_PRODUCTS].sort(), ["colmax", "echotop18", "echotop45", "echotop50", "merged", "vil"]);
  for (const product of OBSERVED_PRODUCTS) {
    assert.equal(isWholeProduct(product), (WHOLE_PRODUCTS as readonly string[]).includes(product), product);
  }
  assert.ok(!isWholeProduct("hx"));
  assert.ok(!isWholeProduct("dmax"));
});
