import assert from "node:assert/strict";
import test from "node:test";

const { snoozedAt, OUTLOOK_SNOOZE_MS } = await import("../../src/lib/outlookDismissal.ts");

/** Closing the dry-day outlook keeps it away for a day, reloads included. */

const closed = 1_800_000_000_000;

test("never closed, it shows", () => {
  assert.equal(snoozedAt(null, closed), false);
});

test("closed, it stays away for the rest of the day", () => {
  assert.equal(snoozedAt(String(closed), closed), true);
  assert.equal(snoozedAt(String(closed), closed + OUTLOOK_SNOOZE_MS - 1), true);
});

test("a day later it is back", () => {
  assert.equal(snoozedAt(String(closed), closed + OUTLOOK_SNOOZE_MS), false);
});

test("a closing it cannot read, or one in the future, does not hide it", () => {
  assert.equal(snoozedAt("garbage", closed), false);
  assert.equal(snoozedAt(String(closed + 60_000), closed), false);
});
