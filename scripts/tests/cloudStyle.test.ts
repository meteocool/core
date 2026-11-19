import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_STYLES, cloudStyleOf, DEFAULT_CLOUD_STYLE, HULL_TINT, hullTint, isMapStyle, MAP_STYLES, mapStyleOf, shellLevels,
  STYLE_FIELD,
} from "../../src/lib/cloudStyle";

test("a style a Studio scene names is taken as it is, and anything else is the cloud", () => {
  for (const style of CLOUD_STYLES) assert.equal(cloudStyleOf(style), style);
  assert.equal(cloudStyleOf("plasma"), "cloud");
  assert.equal(cloudStyleOf(null), "cloud");
  assert.equal(cloudStyleOf(true), "cloud");
});

test("the styles keep their places, which Studio's scene links store, new ones at the end", () => {
  assert.deepEqual(CLOUD_STYLES, ["cloud", "glow", "shells", "sky", "tinted"]);
});

test("the map offers every style but the shells, which are Studio's", () => {
  assert.deepEqual([...MAP_STYLES].sort(), CLOUD_STYLES.filter((style) => style !== "shells").sort());
  assert.ok(MAP_STYLES.includes(DEFAULT_CLOUD_STYLE));
  assert.equal(isMapStyle("shells"), false);
  for (const style of MAP_STYLES) assert.equal(mapStyleOf(style), style);
  // A stored setting or a link naming the shells, or anything else, is the map's default.
  assert.equal(mapStyleOf("shells"), DEFAULT_CLOUD_STYLE);
  assert.equal(mapStyleOf("plasma"), DEFAULT_CLOUD_STYLE);
  assert.equal(mapStyleOf(null), DEFAULT_CLOUD_STYLE);
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

test("a tinted hull stays white over weak echo and never takes the whole palette", () => {
  assert.equal(hullTint(HULL_TINT.from - 10), 0);
  assert.equal(hullTint(HULL_TINT.from), 0);
  assert.equal(hullTint(HULL_TINT.full), HULL_TINT.strength);
  assert.equal(hullTint(70), HULL_TINT.strength);
  assert.ok(HULL_TINT.strength < 1);
  const middle = hullTint((HULL_TINT.from + HULL_TINT.full) / 2);
  assert.ok(middle > 0 && middle < HULL_TINT.strength);
});
