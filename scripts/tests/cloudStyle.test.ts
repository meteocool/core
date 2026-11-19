import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_STYLES, cloudStyleOf, shellLevels, STYLE_FIELD } from "../../src/lib/cloudStyle";

test("a stored or linked style is taken as it is, and anything else is the cloud", () => {
  for (const style of CLOUD_STYLES) assert.equal(cloudStyleOf(style), style);
  assert.equal(cloudStyleOf("plasma"), "cloud");
  assert.equal(cloudStyleOf(null), "cloud");
  assert.equal(cloudStyleOf(true), "cloud");
});

test("whole, the shells stand at every tenth dBZ from their floor", () => {
  assert.deepEqual(shellLevels(STYLE_FIELD.shells.floor), [10, 20, 30, 40, 50, 60]);
});

test("peeled, the outermost shell is where the peel is and the levels under it are gone", () => {
  assert.deepEqual(shellLevels(27.5), [27.5, 30, 40, 50, 60]);
  // On a level exactly, that level is the outermost, once.
  assert.deepEqual(shellLevels(40), [40, 50, 60]);
  // Past the last, the peel's own surface is all that is left.
  assert.deepEqual(shellLevels(63), [63]);
});
