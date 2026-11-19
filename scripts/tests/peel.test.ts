import assert from "node:assert/strict";
import test from "node:test";
import { defaultPeel, PEEL_ZOOMS, peelLow, peelShare } from "../../src/lib/peel.ts";

test("the lit cloud starts peeled most of the way, every other style whole", () => {
  assert.ok(defaultPeel("cloud") > 0.4 && defaultPeel("cloud") < 0.8);
  assert.equal(defaultPeel("glow"), 0);
  assert.equal(defaultPeel("shells"), 0);
  assert.equal(defaultPeel("a style of some later build"), 0);
});

test("one level leaves a strong storm from its moderate rain up, and faint showers as they are", () => {
  const level = defaultPeel("cloud");
  // A storm whose core reaches 44 dBZ over a 20 dBZ floor: green to yellow.
  const strong = peelLow(20, 44, level);
  assert.ok(strong > 30 && strong < 40, String(strong));
  // Showers with no core above the floor: nothing to peel.
  assert.equal(peelLow(20, 20, level), 20);
  assert.equal(peelLow(20, 12, level), 20);
  // Whole at none, down to the core at all, and never past either.
  assert.equal(peelLow(20, 44, 0), 20);
  assert.equal(peelLow(20, 44, 1), 44);
  assert.equal(peelLow(20, 44, 7), 44);
  assert.equal(peelLow(20, 44, -1), 20);
});

test("the default peel comes in as the camera closes in; the reader's own is drawn everywhere", () => {
  assert.equal(peelShare(PEEL_ZOOMS[0] - 2, false), 0);
  assert.equal(peelShare(PEEL_ZOOMS[0], false), 0);
  assert.equal(peelShare(PEEL_ZOOMS[1], false), 1);
  assert.equal(peelShare(12, false), 1);
  const halfway = peelShare((PEEL_ZOOMS[0] + PEEL_ZOOMS[1]) / 2, false);
  assert.ok(Math.abs(halfway - 0.5) < 1e-9);
  // Rising all the way: no zoom at which a storm grows back as the camera nears.
  let before = 0;
  for (let zoom = 5; zoom <= 9; zoom += 0.1) {
    const share = peelShare(zoom, false);
    assert.ok(share >= before);
    before = share;
  }
  assert.equal(peelShare(3, true), 1);
});
