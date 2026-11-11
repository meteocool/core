import assert from "node:assert/strict";
import test from "node:test";
import { FrameSwitch, ancestorTile, blendTexel, childTiles, fadeWeight, settled } from "../../src/lib/frameSwitch.ts";
import type { TileCoord } from "../../src/lib/frameSwitch.ts";

/**
 * A radar source's picture moves to its next frame whole, once every tile
 * of it is ready, never two times at once; fades between them in value; and
 * fills a missing tile from the same frame's coarser or finer ones.
 */

const frame = (key: string, snapshot = 0) => ({ key, snapshot });

test("the first frame is shown at once, drawn as its tiles come", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  assert.equal(frames.shown?.key, "t0");
  assert.equal(frames.pending, false);
});

test("the next frame waits until it is settled, the one before shown meanwhile", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.want(frame("t1"));
  assert.equal(frames.pending, true);
  assert.equal(frames.shown?.key, "t0");
  frames.settle(100, false);
  assert.equal(frames.shown?.key, "t1");
  assert.equal(frames.pending, false);
  assert.equal(frames.from, null, "no fade asked for, none had");
});

test("asked for another frame before the last arrived, it waits for that one, still showing the first", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.want(frame("t1"));
  frames.want(frame("t2"));
  assert.equal(frames.shown?.key, "t0");
  assert.equal(frames.wanted?.key, "t2");
});

test("asked for the frame shown again, the switch is off, and a newer snapshot of it replaces it in place", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.want(frame("t1"));
  frames.want(frame("t0", 1));
  assert.equal(frames.pending, false);
  assert.equal(frames.shown?.snapshot, 1);
});

test("hidden, it shows nothing, and starts afresh from the next frame it is asked for", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.hide();
  assert.equal(frames.shown, null);
  frames.want(frame("t5"));
  assert.equal(frames.shown?.key, "t5", "not an hour-old frame standing in");
});

test("told to wait, it draws nothing until its frame is whole, however many it is asked for meanwhile", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.hide();
  frames.want(frame("t5"));
  // Another source stands in for it: it comes in whole, not tile by tile.
  frames.wait();
  assert.equal(frames.shown, null);
  assert.equal(frames.pending, true);
  frames.want(frame("t10"));
  assert.equal(frames.shown, null, "a newer frame asked for is not shown at once either");
  frames.settle(1000, false);
  assert.equal(frames.shown?.key, "t10");
  assert.equal(frames.waiting, false);
});

test("a wait called off shows the frame asked for at once, drawn as its tiles come", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.hide();
  frames.wait();
  frames.want(frame("t5"));
  frames.release();
  assert.equal(frames.shown?.key, "t5");
  assert.equal(frames.pending, false);
  frames.want(frame("t10"));
  assert.equal(frames.shown?.key, "t5", "from then on it switches whole, as ever");
  frames.release();
  assert.equal(frames.shown?.key, "t5", "calling off no wait changes nothing");
});

test("with no frame asked for there is nothing to wait for", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.wait();
  assert.equal(frames.waiting, false);
  frames.want(frame("t0"));
  assert.equal(frames.shown?.key, "t0");
});

test("a fade runs from the frame before for its duration, then is over", () => {
  const frames = new FrameSwitch<ReturnType<typeof frame>>();
  frames.want(frame("t0"));
  frames.want(frame("t1"));
  frames.settle(1000, true);
  assert.equal(frames.from?.key, "t0");
  assert.equal(frames.fade(1000, 200), 0);
  assert.equal(frames.fade(1100, 200), 0.5);
  assert.equal(frames.fade(1200, 200), 1);
  assert.equal(frames.from, null);
  assert.equal(frames.fade(1300, 200), 1);
});

test("the fade's weight runs from 0 to 1 over its duration; no duration cuts", () => {
  assert.equal(fadeWeight(-5, 180), 0);
  assert.equal(fadeWeight(90, 180), 0.5);
  assert.equal(fadeWeight(500, 180), 1);
  assert.equal(fadeWeight(0, 0), 1);
});

test("in a fade, two drawn values meet between them, before the palette", () => {
  const drawn = (value: number) => value > 0;
  assert.deepEqual(blendTexel(100, 140, 0.5, drawn), { value: 120, weight: 1 });
  assert.deepEqual(blendTexel(100, 140, 0, drawn), { value: 100, weight: 1 }, "starting from the frame before");
  assert.deepEqual(blendTexel(100, 140, 1, drawn), { value: 140, weight: 1 });
  assert.deepEqual(blendTexel(100, 101, 0.5, drawn), { value: 101, weight: 1 }, "rounded to a byte");
});

test("rain that comes or goes in a fade fades in or out, in its own colour", () => {
  const drawn = (value: number) => value > 0;
  assert.deepEqual(blendTexel(0, 140, 0.25, drawn), { value: 140, weight: 0.25 });
  assert.deepEqual(blendTexel(140, 0, 0.25, drawn), { value: 140, weight: 0.75 });
  assert.deepEqual(blendTexel(0, 0, 0.5, drawn), { value: 0, weight: 0 });
});

test("a byte the palette draws nothing for is never blended into, whatever its number", () => {
  // An echo top's 255 is "no radar", drawn as nothing like 0.
  const drawn = (value: number) => value > 0 && value < 255;
  assert.deepEqual(blendTexel(255, 40, 0.5, drawn), { value: 40, weight: 0.5 });
});

test("a missing tile is drawn from the nearest coarser one ready, two zooms up at most", () => {
  const ready = new Set(["5/8/10"]);
  const has = ({ z, x, y }: TileCoord) => ready.has(`${z}/${x}/${y}`);
  assert.deepEqual(ancestorTile({ z: 7, x: 33, y: 41 }, 3, has), { z: 5, x: 8, y: 10 });
  assert.equal(ancestorTile({ z: 8, x: 66, y: 82 }, 3, has), null, "three up is too coarse");
  ready.add("6/16/20");
  assert.deepEqual(ancestorTile({ z: 7, x: 33, y: 41 }, 3, has), { z: 6, x: 16, y: 20 }, "the nearest first");
  assert.equal(ancestorTile({ z: 3, x: 4, y: 5 }, 3, () => true), null, "none above the source's least zoom");
});

test("zooming out, a missing tile is drawn from the finer ones ready", () => {
  const ready = new Set(["6/16/20", "6/17/21"]);
  const has = ({ z, x, y }: TileCoord) => ready.has(`${z}/${x}/${y}`);
  assert.deepEqual(childTiles({ z: 5, x: 8, y: 10 }, 8, has), [{ z: 6, x: 16, y: 20 }, { z: 6, x: 17, y: 21 }]);
  assert.deepEqual(childTiles({ z: 8, x: 8, y: 10 }, 8, () => true), [], "none past the source's deepest zoom");
});

test("a frame is switched to only once every one of its tiles is settled", () => {
  const ready = new Set(["a", "b"]);
  assert.equal(settled(["a", "b"], (key) => ready.has(key)), true);
  assert.equal(settled(["a", "b", "c"], (key) => ready.has(key)), false);
  assert.equal(settled([], () => false), true, "a frame with nothing in view");
});
