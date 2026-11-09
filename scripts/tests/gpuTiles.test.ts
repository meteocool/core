import assert from "node:assert/strict";
import test from "node:test";
import { BLANK } from "../../src/lib/decodedTiles.ts";
import { GpuTiles } from "../../src/lib/gpuTiles.ts";

/**
 * Tiles uploaded to the GPU: bounded in bytes, the least recently drawn let
 * go first, the plan's after the rest, and never one in the picture drawn.
 */

/** A store of `capacity` bytes whose handles are names, and the names it let go. */
function store(capacity: number, maxEntries?: number) {
  const released: string[] = [];
  return { tiles: new GpuTiles<string>(capacity, (handle) => released.push(handle), maxEntries), released };
}

test("tiles are kept by key and counted in bytes; a blank costs none", () => {
  const { tiles } = store(1000);
  tiles.put("a", "texture a", 400);
  tiles.put("b", BLANK, 0);
  assert.equal(tiles.get("a"), "texture a");
  assert.equal(tiles.get("b"), BLANK);
  assert.equal(tiles.has("c"), false);
  assert.equal(tiles.bytes, 400);
  assert.equal(tiles.size, 2);
});

test("past its bytes the least recently used goes, and its texture with it", () => {
  const { tiles, released } = store(1000);
  tiles.put("a", "ta", 400);
  tiles.put("b", "tb", 400);
  tiles.get("a");
  tiles.put("c", "tc", 400);
  assert.deepEqual(released, ["tb"]);
  assert.equal(tiles.has("a"), true);
  assert.equal(tiles.bytes, 800);
});

test("a tile replaced lets its old texture go", () => {
  const { tiles, released } = store(1000);
  tiles.put("a", "old", 400);
  tiles.put("a", "new", 500);
  assert.deepEqual(released, ["old"]);
  assert.equal(tiles.bytes, 500);
});

test("the plan's tiles outlive the others, and go only once those are gone", () => {
  const { tiles, released } = store(1000);
  tiles.retain(["a", "b", "c", "d"]);
  tiles.put("a", "ta", 300);
  tiles.put("b", "tb", 300);
  tiles.put("x", "tx", 300);
  tiles.put("c", "tc", 300);
  assert.deepEqual(released, ["tx"], "the one no plan wants goes first, though newer");
  tiles.put("d", "td", 300);
  assert.deepEqual(released, ["tx", "ta"], "then the least recent the plan wants");
});

test("a tile in the picture being drawn is never let go, whatever the budget", () => {
  const { tiles, released } = store(500);
  tiles.put("a", "ta", 400);
  tiles.pin("a");
  tiles.pin("b");
  tiles.put("b", "tb", 400);
  assert.equal(tiles.has("a"), true);
  assert.deepEqual(released, []);
  assert.equal(tiles.bytes, 800, "over budget while both are drawn");
  tiles.unpinAll();
  assert.deepEqual(released, ["ta"], "and back under once the draw is done");
  tiles.pin("b");
  tiles.put("c", "tc", 400);
  assert.deepEqual(released, ["ta", "tc"], "one not drawn goes rather than one drawn, however new");
});

test("blanks are bounded by their number", () => {
  const { tiles } = store(1000, 3);
  for (const key of ["a", "b", "c", "d"]) tiles.put(key, BLANK, 0);
  assert.equal(tiles.size, 3);
  assert.equal(tiles.has("a"), false);
});

test("closing the player lets every texture go but those on screen", () => {
  const { tiles, released } = store(10_000);
  tiles.put("shown", "ts", 400);
  tiles.put("old", "to", 400);
  tiles.pin("shown");
  tiles.dropUnpinned();
  assert.deepEqual(released, ["to"]);
  assert.equal(tiles.has("shown"), true);
});

test("cleared, every texture is let go, unless the context took them already", () => {
  const { tiles, released } = store(10_000);
  tiles.put("a", "ta", 400);
  tiles.put("b", BLANK, 0);
  tiles.clear();
  assert.deepEqual(released, ["ta"], "a blank has nothing to let go");
  assert.equal(tiles.bytes, 0);
  tiles.put("c", "tc", 400);
  tiles.clear(false);
  assert.deepEqual(released, ["ta"]);
  assert.equal(tiles.size, 0);
});
