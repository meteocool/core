import assert from "node:assert/strict";
import test from "node:test";
import { greyedOut, STALE_COLOUR_KEPT, STALE_GREY, tagPrecedence } from "../../src/lib/staleTint.ts";

/**
 * A "3D" tag for a storm a scan behind its radar: grey over the cube's colour,
 * and giving way to current tags where they crowd each other.
 */

const GREY: [number, number, number] = [158, 162, 168];

test("a greyed cube is mostly the grey, with a little of its colour left", () => {
  const [r, g, b] = greyedOut([255, 0, 0], GREY);
  assert.equal(r, Math.round(GREY[0] * (1 - STALE_COLOUR_KEPT) + 255 * STALE_COLOUR_KEPT));
  assert.ok(r > GREY[0], "some of the red shows through");
  assert.ok(g < GREY[1] && b < GREY[2]);
  assert.ok(STALE_COLOUR_KEPT > 0 && STALE_COLOUR_KEPT <= 0.2);
});

test("greyed, a strong and a weak core still differ, but far less than in colour", () => {
  const strong: [number, number, number] = [200, 0, 200];
  const weak: [number, number, number] = [0, 200, 0];
  const apart = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
  const greyed = apart(greyedOut(strong, GREY), greyedOut(weak, GREY));
  assert.ok(greyed > 0);
  assert.ok(greyed < apart(strong, weak) / 4);
});

test("a cube the grey's own colour stays as it is", () => {
  assert.deepEqual(greyedOut(GREY, GREY), GREY);
});

test("a current tag wins over a stale one, however much stronger the stale core", () => {
  assert.ok(tagPrecedence({ stale: false, peak: 30 }, { stale: true, peak: 60 }) < 0);
  assert.ok(tagPrecedence({ stale: true, peak: 60 }, { stale: false, peak: 30 }) > 0);
});

test("between two tags alike, the stronger core wins", () => {
  assert.ok(tagPrecedence({ stale: false, peak: 55 }, { stale: false, peak: 40 }) < 0);
  assert.ok(tagPrecedence({ stale: true, peak: 40 }, { stale: true, peak: 55 }) > 0);
});

test("the grey is darker on a dark map than on a light one", () => {
  const { light, dark } = STALE_GREY;
  assert.ok(dark.every((channel, i) => channel < light[i]));
});
