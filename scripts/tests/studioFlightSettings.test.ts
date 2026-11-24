import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, readSettings } from "../../src/lib/studio/flight/settings.ts";

test("a first flight has the radar beams off", () => {
  assert.equal(DEFAULT_SETTINGS.radarBeams, false);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
});

test("a setting kept is read back as it was kept", () => {
  assert.equal(readSettings(JSON.stringify({ radarBeams: true })).radarBeams, true);
});

test("settings kept unreadably are read as a first flight has them", () => {
  assert.deepEqual(readSettings("{not json"), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings("[true]"), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings("true"), DEFAULT_SETTINGS);
});

test("a setting kept as something other than on or off is read as a first flight has it", () => {
  assert.equal(readSettings(JSON.stringify({ radarBeams: "yes" })).radarBeams, false);
});

test("a setting no longer offered is forgotten", () => {
  assert.deepEqual(Object.keys(readSettings(JSON.stringify({ radarBeams: true, gone: true }))), Object.keys(DEFAULT_SETTINGS));
});
