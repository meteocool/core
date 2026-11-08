import assert from "node:assert/strict";
import test from "node:test";
import { escapeBelongsToField, type KeyTarget } from "../../src/lib/escapeTarget.ts";

const target = (overrides: Partial<KeyTarget>): KeyTarget => ({ editable: false, field: false, inTray: false, ...overrides });

test("a key whose target is not an element closes the tray", () => {
  assert.equal(escapeBelongsToField(null), false);
});

test("a plain element outside any field closes the tray", () => {
  assert.equal(escapeBelongsToField(target({})), false);
});

test("a field outside the tray keeps its Escape", () => {
  assert.equal(escapeBelongsToField(target({ field: true })), true);
});

test("the tray's own field closes the tray", () => {
  assert.equal(escapeBelongsToField(target({ field: true, inTray: true })), false);
});

test("an editable element keeps its Escape, in the tray or not", () => {
  assert.equal(escapeBelongsToField(target({ editable: true })), true);
  assert.equal(escapeBelongsToField(target({ editable: true, inTray: true })), true);
});
