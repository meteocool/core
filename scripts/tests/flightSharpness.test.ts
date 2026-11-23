import assert from "node:assert/strict";
import test from "node:test";
import { HOLD_S, QUALITY_LEAST, Sharpness } from "../../src/lib/studio/flight/sharpness.ts";

/** Fly `seconds` with frames coming as `fps(quality)` says: every sharpness the flight was drawn at, one a frame. */
function fly(sharpness: Sharpness, seconds: number, fps: (quality: number) => number): number[] {
  const seen: number[] = [];
  for (let t = 0; t < seconds; ) {
    const elapsed = 1 / fps(sharpness.quality);
    sharpness.frame(elapsed);
    seen.push(sharpness.quality);
    t += elapsed;
  }
  return seen;
}

/** The frames of a flight whose own drawing is the work: as many more as the sharpness given up. */
const ownWork = (atFull: number) => (quality: number) => atFull / quality;

test("a flight its machine draws fast enough stays at all of its sharpness", () => {
  const sharpness = new Sharpness(1);
  assert.deepEqual(new Set(fly(sharpness, 60, () => 60)), new Set([1]));
});

test("a flight slow by its own drawing gives up as much as it takes, and no more", () => {
  const sharpness = new Sharpness(1);
  const seen = fly(sharpness, 60, ownWork(25));
  assert.ok(Math.abs(sharpness.quality - 0.7) < 1e-9, `settled at ${sharpness.quality}`);
  assert.ok(Math.min(...seen) > 0.69);
});

test("a flight far too slow by its own drawing goes most of the way down", () => {
  const sharpness = new Sharpness(1);
  fly(sharpness, 60, ownWork(9));
  assert.ok(sharpness.quality <= 0.25 + 1e-9 && sharpness.quality > QUALITY_LEAST, `settled at ${sharpness.quality}`);
});

test("frames as few at any sharpness, as with another program on the GPU, never take a flight to the least", () => {
  const sharpness = new Sharpness(1);
  const seen = fly(sharpness, 120, () => 9);
  assert.ok(Math.min(...seen) >= 0.4 - 1e-9, `went down to ${Math.min(...seen)}`);
  // Most of the time it is drawn as sharp as it was: giving it up gained nothing.
  assert.ok(seen.filter((quality) => quality === 1).length / seen.length > 0.8);
});

test("each way down that does not help keeps the next one off for longer", () => {
  const sharpness = new Sharpness(1);
  const seen = fly(sharpness, 200, () => 9);
  const descents = seen.filter((quality, i) => i > 0 && quality < 1 && seen[i - 1] === 1).length;
  // Holds of 20, 40, 80 s and a way down of about five seconds each: four in 200 s, not ten.
  assert.ok(descents >= 3 && descents <= 4, `${descents} descents`);
});

test("a slow stretch that is not the flight's leaves it sharp once it has passed", () => {
  const sharpness = new Sharpness(1);
  fly(sharpness, 30, () => 9);
  fly(sharpness, HOLD_S, () => 100);
  assert.equal(sharpness.quality, 1);
});

test("a flight that went down for its own drawing comes back up once frames are plenty", () => {
  const sharpness = new Sharpness(1);
  fly(sharpness, 30, ownWork(25));
  assert.ok(sharpness.quality < 1);
  fly(sharpness, 120, () => 100);
  assert.equal(sharpness.quality, 1);
});
