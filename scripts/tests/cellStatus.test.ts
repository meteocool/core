import assert from "node:assert/strict";
import test from "node:test";
import { STALE_MINUTES, cellStatus } from "../../src/lib/cellStatus.ts";

/**
 * A storm that stopped, a storm that became two storms, and a storm nobody has
 * looked at in twenty minutes are three different things, and the panel used
 * to draw the first two identically and the third not at all.
 */

const live = { active: true, ageMinutes: 3 };

test("a recently detected active cell is live", () => {
  assert.deepEqual(cellStatus(live), { kind: "live", label: "live" });
});

test("one missed run is jitter, not staleness", () => {
  assert.equal(cellStatus({ active: true, ageMinutes: 6 }).kind, "live");
});

test("an active cell nothing has been heard from is stale", () => {
  assert.equal(cellStatus({ active: true, ageMinutes: STALE_MINUTES }).kind, "stale");
  assert.equal(cellStatus({ active: true, ageMinutes: 40 }).kind, "stale");
});

test("an ended cell with children was superseded, not lost", () => {
  const status = cellStatus({ active: false, child_codes: ["B"], ageMinutes: 5 });
  assert.deepEqual(status, { kind: "superseded", label: "superseded" });
});

test("an ended cell with nowhere to go dissipated", () => {
  assert.equal(cellStatus({ active: false, child_codes: [], ageMinutes: 5 }).kind, "ended");
  assert.equal(cellStatus({ active: false, ageMinutes: 5 }).kind, "ended");
});

test("age never promotes an ended cell back to stale", () => {
  // The cell is gone; how long ago it went is the footer's business.
  assert.equal(cellStatus({ active: false, ageMinutes: 300 }).kind, "ended");
});
