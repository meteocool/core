import assert from "node:assert/strict";
import test from "node:test";
import { RAIN_SHARE, rainView, tileBox } from "../../src/lib/studio/flight/rainView.ts";
import type { Box } from "../../src/lib/studio/flight/rainView.ts";

/** A block of zoom-10 tiles, `across` by `down`, from tile x, y. */
const block = (x: number, y: number, across: number, down: number): Box[] => Array.from(
  { length: across * down }, (_, i) => tileBox([10, x + (i % across), y + Math.floor(i / across)]),
);
const shareOf = (boxes: readonly Box[], view: { x: number; y: number; resolution: number }, width: number, height: number) => {
  const [hw, hh] = [(width * view.resolution) / 2, (height * view.resolution) / 2];
  const covered = boxes.reduce((sum, [w, s, e, n]) => {
    const dx = Math.min(e, view.x + hw) - Math.max(w, view.x - hw);
    const dy = Math.min(n, view.y + hh) - Math.max(s, view.y - hh);
    return sum + (dx > 0 && dy > 0 ? dx * dy : 0);
  }, 0);
  return covered / (4 * hw * hh);
};

test("a zoom-10 tile's box: the world's width over 1024, from the north-west", () => {
  const [w, s, e, n] = tileBox([10, 0, 0]);
  assert.ok(Math.abs(e - w - 40075016.68 / 1024) < 1e-3);
  assert.ok(Math.abs(n - s - (e - w)) < 1e-6);
  assert.ok(Math.abs(w + 20037508.34) < 1e-2 && Math.abs(n - 20037508.34) < 1e-2);
});

test("the view onto rain is filled at least half by it, and shows the large system rather than the shower", () => {
  const system = block(530, 360, 12, 8);
  const shower = block(560, 340, 1, 1);
  const boxes = [...system, ...shower];
  const view = rainView(boxes, 800, 900);
  assert.ok(view);
  const share = shareOf(boxes, view, 800, 900);
  assert.ok(share >= RAIN_SHARE, `share ${share}`);
  assert.ok(Math.abs(view.share - share) < 1e-9);
  const [w, s, e, n] = [system[0][0], system.at(-1)![1], system.at(-1)![2], system[0][3]];
  assert.ok(view.x > w && view.x < e && view.y > s && view.y < n, "on the system");
  // As wide as half-filled allows: a zoom further out would not be.
  assert.ok(shareOf(boxes, { ...view, resolution: view.resolution * 2 ** 0.25 }, 800, 900) < RAIN_SHARE || view.resolution >= 2 * 20037508.34 / 256 / 2 ** 5);
});

test("where no view is half rain, the one most of it is", () => {
  const view = rainView(block(540, 350, 1, 1), 1200, 1200);
  assert.ok(view);
  assert.equal(view.resolution, 2 * 20037508.342789244 / 256 / 2 ** 10);
});

test("no rain, no view", () => {
  assert.equal(rainView([], 800, 600), null);
  assert.equal(rainView(block(540, 350, 1, 1), 0, 600), null);
});
