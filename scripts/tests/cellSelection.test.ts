import assert from "node:assert/strict";
import test from "node:test";
import { NO_SELECTION, afterClose, nextSelection } from "../../src/lib/cellSelection.ts";

/**
 * The two steps between tapping a storm and reading about it.
 *
 * On a phone the detail panel covers the storm it describes, so the forecast
 * and the panel stop being one action: the first tap draws the cone, the
 * second opens the numbers. Everywhere else the panel takes a corner of a
 * large map and a tap does both, as it always did.
 */

const none = NO_SELECTION;
const drawn = { code: "A", details: false };
const open = { code: "A", details: true };

test("a desktop tap opens the panel on the first one", () => {
  assert.deepEqual(nextSelection(none, "A", false), open);
});

test("a desktop tap on another cell moves the open panel to it", () => {
  assert.deepEqual(nextSelection(open, "B", false), { code: "B", details: true });
});

test("a phone's first tap draws the cell without opening the panel", () => {
  assert.deepEqual(nextSelection(none, "A", true), drawn);
});

test("a phone's second tap on the same cell opens it", () => {
  assert.deepEqual(nextSelection(drawn, "A", true), open);
});

test("a phone tap on a different cell starts that one over at the drawing", () => {
  // Not straight into the panel: the tap said "that storm", and answering with
  // a screen of numbers over it is the thing the two steps exist to avoid.
  assert.deepEqual(nextSelection(open, "B", true), { code: "B", details: false });
});

test("tapping the open cell again leaves the panel open", () => {
  // The panel does not cover the whole map, so its cell stays tappable. That
  // tap must not toggle the panel shut from behind it.
  assert.deepEqual(nextSelection(open, "A", true), open);
});

test("the map background clears everything, on either", () => {
  assert.deepEqual(nextSelection(open, null, true), none);
  assert.deepEqual(nextSelection(open, null, false), none);
  assert.deepEqual(nextSelection(drawn, null, true), none);
});

test("closing on a phone keeps the forecast on the map", () => {
  // Closing the numbers is how a reader asks to see the map again; throwing
  // the cone away with them would mean tapping twice to get it back.
  assert.deepEqual(afterClose(open, true), drawn);
});

test("closing anywhere else clears the selection", () => {
  assert.deepEqual(afterClose(open, false), none);
});
