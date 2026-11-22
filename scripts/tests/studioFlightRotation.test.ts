import assert from "node:assert/strict";
import test from "node:test";
import { FLIGHT_ROTATION, nextInRotation, rotationOpening } from "../../src/lib/studio/flight/soundtrack.ts";

test("a flight's music opens with the theme, never with the menus' piece it took off to", () => {
  assert.equal(FLIGHT_ROTATION[0], "theme");
  assert.deepEqual([...FLIGHT_ROTATION].sort(), ["menu", "theme", "theme2"], "both themes and the menus' piece, once each");
  assert.equal(rotationOpening([true, true]), 0);
  // The menus' piece came first (the meteoair page fetches it before the flight's): the theme still opens once it is had.
  assert.equal(rotationOpening([false, true]), 1);
  assert.equal(rotationOpening([true, false]), 0);
  assert.equal(rotationOpening([false, false]), 0);
});

test("the rotation takes its files in turn, round again, passing over what has not come", () => {
  assert.equal(nextInRotation(0, [true, true]), 1);
  assert.equal(nextInRotation(1, [true, true]), 0);
  assert.equal(nextInRotation(0, [true, false]), 0, "one file loops");
  assert.equal(nextInRotation(0, [true, false, true]), 2);
  assert.equal(nextInRotation(2, [true, false, true]), 0);
  assert.equal(nextInRotation(0, [false, false]), 0);
});
