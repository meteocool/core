import assert from "node:assert/strict";
import test from "node:test";
import { boxToFrame, deltaToFrame, toFrame, turnHeld } from "../../src/lib/sideways.ts";
import type { Turn } from "../../src/lib/sideways.ts";

/**
 * The page on its side (src/lib/sideways.ts): a point, a movement and a box
 * on the upright screen, as they lie in the picture turned onto it. The
 * screen is a phone's, 390 wide and 844 tall; the picture 844 wide and 390
 * tall.
 */
const PHONE = { width: 390, height: 844 };

/**
 * Where the CSS transform (global.css) draws a point of the picture on the
 * screen: <body> centred on the screen and turned about its middle.
 */
function drawn(x: number, y: number, turn: Turn): [number, number] {
  const radians = (turn * Math.PI) / 180;
  const [cx, cy] = [x - PHONE.height / 2, y - PHONE.width / 2];
  return [
    PHONE.width / 2 + cx * Math.cos(radians) - cy * Math.sin(radians),
    PHONE.height / 2 + cx * Math.sin(radians) + cy * Math.cos(radians),
  ];
}

const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-9, `${a} is not ${b}`));

test("upright, the screen is the picture", () => {
  assert.deepEqual(toFrame(12, 34, 0, PHONE), [12, 34]);
  assert.deepEqual(deltaToFrame(-5, 7, 0), [-5, 7]);
  assert.deepEqual(boxToFrame({ left: 1, top: 2, width: 3, height: 4 }, 0, PHONE), { left: 1, top: 2, width: 3, height: 4 });
});

for (const turn of [90, -90] as const) {
  test(`turned ${turn}: a point of the picture, drawn on the screen and read back, is where it was`, () => {
    for (const [x, y] of [[0, 0], [844, 390], [100, 50], [700, 300], [422, 195]]) {
      const [sx, sy] = drawn(x, y, turn);
      near(toFrame(sx, sy, turn, PHONE), [x, y]);
    }
  });

  test(`turned ${turn}: the screen's corners are the picture's, and a movement goes the picture's way`, () => {
    const corners = [[0, 0], [390, 0], [0, 844], [390, 844]].map(([x, y]) => toFrame(x, y, turn, PHONE));
    for (const [x, y] of corners) {
      assert.ok([0, 844].includes(x) && [0, 390].includes(y), `${x},${y} is not a corner of the picture`);
    }
    // A finger moving from one point of the screen to another moves as far across the picture, between where those are in it.
    const [from, to] = [[100, 200], [130, 160]];
    const [fx, fy] = toFrame(from[0], from[1], turn, PHONE);
    const [tx, ty] = toFrame(to[0], to[1], turn, PHONE);
    near(deltaToFrame(to[0] - from[0], to[1] - from[1], turn), [tx - fx, ty - fy]);
  });

  test(`turned ${turn}: an element's box on the screen is its box in the picture`, () => {
    // A box in the picture, 100 by 40 at (600, 300), as the screen measures it: the smallest box round its drawn corners.
    const corners = [[600, 300], [700, 300], [600, 340], [700, 340]].map(([x, y]) => drawn(x, y, turn));
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const measured = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const box = boxToFrame(measured, turn, PHONE);
    near([box.left, box.top, box.width, box.height], [600, 300, 100, 40]);
  });
}

test("held with its top to the left, the picture's top is the screen's right edge, and its right is down the screen", () => {
  // The picture's right is down the upright screen, its top the screen's right edge.
  near(deltaToFrame(0, 10, 90), [10, 0]);
  near(deltaToFrame(10, 0, 90), [0, -10]);
  // The other way round, the picture's right is up the screen.
  near(deltaToFrame(0, -10, -90), [10, 0]);
  assert.deepEqual(toFrame(0, 0, 90, PHONE), [0, 390]);
  assert.deepEqual(toFrame(390, 0, 90, PHONE), [0, 0]);
});

test("how the phone is held says which way round to draw, and lying flat or upright says nothing", () => {
  // Upright landscape, its left side down: the top of the phone to the left.
  assert.equal(turnHeld(0, -90), 90);
  assert.equal(turnHeld(0, 90), -90);
  // Tipped back like a game is held, still with its left side lower.
  assert.equal(turnHeld(10, -50), 90);
  assert.equal(turnHeld(-10, 55), -90);
  // Flat on a table, or upright as a phone is read.
  assert.equal(turnHeld(0, 0), null);
  assert.equal(turnHeld(2, -20), null);
  assert.equal(turnHeld(90, 0), null);
  assert.equal(turnHeld(70, -40), null);
});
