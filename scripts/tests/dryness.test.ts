import assert from "node:assert/strict";
import test from "node:test";
import { isDry } from "../../src/lib/dryness.ts";

/**
 * The verdict behind the dry-weather hint on the map. Wrong one way, the hint
 * says "no rain in sight" over a shower; wrong the other, it never shows.
 */

test("every step at the scale's floor is dry", () => {
  assert.equal(isDry({ 1: { dbz: -32.5 }, 2: { dbz: -32.5 }, 3: { dbz: 0 } }), true);
});

test("one step of echo, past or forecast, is not dry", () => {
  assert.equal(isDry({ 1: { dbz: -32.5 }, 2: { dbz: 12.4 }, 3: { dbz: -32.5 } }), false);
});

test("a grid with no readings is unknown, not dry", () => {
  assert.equal(isDry({ 1: { dbz: null }, 2: null, 3: {} }), false);
  assert.equal(isDry({}), false);
  assert.equal(isDry(null), false);
});

test("missing steps among real readings do not count either way", () => {
  assert.equal(isDry({ 1: null, 2: { dbz: -32.5 }, 3: { dbz: null } }), true);
});
