import assert from "node:assert/strict";
import test from "node:test";
import { BLANK, DecodedTiles, ENTRY_OVERHEAD, costOf, tileKey } from "../../src/lib/decodedTiles.ts";

/**
 * Value tiles decoded ahead of playback: kept by what decides their bytes,
 * bounded in bytes, and the frames the plan still wants kept over others.
 */

/** A tile of `bytes` values. */
const tile = (bytes: number) => new Uint8Array(bytes);

/** Room for `tiles` tiles of `bytes` each, overhead included. */
const room = (tiles: number, bytes = 1000) => tiles * (bytes + ENTRY_OVERHEAD);

const parts = { template: "/tiles/meteoradar/a/{z}/{x}/{-y}.png", z: 7, x: 66, y: 43, holes: [], keep: null, size: 512 };

test("two tiles share a key exactly when everything that decides their bytes is the same", () => {
  const key = tileKey(parts);
  assert.equal(tileKey({ ...parts }), key);
  assert.notEqual(tileKey({ ...parts, template: "/tiles/meteoradar/b/{z}/{x}/{-y}.png" }), key);
  assert.notEqual(tileKey({ ...parts, y: 44 }), key);
  assert.notEqual(tileKey({ ...parts, holes: ["p1"] }), key, "a frame with a network cut out is another tile");
  assert.notEqual(tileKey({ ...parts, keep: "p2" }), key, "so is one kept to a network's ground");
  assert.notEqual(tileKey({ ...parts, size: 256 }), key);
});

test("a tile kept is the very array handed in, not a copy", () => {
  const store = new DecodedTiles(room(4));
  const bytes = tile(1000);
  store.put("a", bytes);
  assert.equal(store.get("a"), bytes);
  assert.equal(store.has("b"), false);
  assert.equal(store.get("b"), undefined);
});

test("what is held is counted in bytes, a blank by its overhead alone", () => {
  const store = new DecodedTiles(room(4));
  store.put("a", tile(1000));
  store.put("b", BLANK);
  assert.equal(store.bytes, 1000 + 2 * ENTRY_OVERHEAD);
  assert.equal(costOf(BLANK), ENTRY_OVERHEAD);
  store.put("a", tile(500));
  assert.equal(store.bytes, 500 + 2 * ENTRY_OVERHEAD, "a tile put again is counted once");
  store.delete("a");
  assert.equal(store.bytes, ENTRY_OVERHEAD);
});

test("past its bytes, the least recently used tile goes first", () => {
  const store = new DecodedTiles(room(2));
  store.put("a", tile(1000));
  store.put("b", tile(1000));
  store.get("a");
  store.put("c", tile(1000));
  assert.deepEqual(["a", "b", "c"].filter((key) => store.has(key)), ["a", "c"]);
  assert.ok(store.bytes <= store.capacity);
});

test("looking without using leaves the order as it was", () => {
  const store = new DecodedTiles(room(2));
  store.put("a", tile(1000));
  store.put("b", tile(1000));
  assert.ok(store.peek("a"));
  store.put("c", tile(1000));
  assert.equal(store.has("a"), false);
});

test("tiles the plan retains outlive those it does not, however recently those were used", () => {
  // A loop longer than the store: the frames ahead of the needle are
  // retained, the one just played is not, and it is the one to go.
  const store = new DecodedTiles(room(3));
  store.put("next", tile(1000));
  store.put("after", tile(1000));
  store.put("played", tile(1000));
  store.retain(["next", "after", "later"]);
  store.put("later", tile(1000));
  assert.deepEqual(["next", "after", "played", "later"].filter((key) => store.has(key)), ["next", "after", "later"]);
});

test("with only retained tiles left, the least recently used of them goes", () => {
  const store = new DecodedTiles(room(2));
  store.retain(["a", "b", "c"]);
  store.put("a", tile(1000));
  store.put("b", tile(1000));
  store.put("c", tile(1000));
  assert.deepEqual(["a", "b", "c"].filter((key) => store.has(key)), ["b", "c"]);
});

test("a tile bigger than the whole store is not kept", () => {
  const store = new DecodedTiles(room(1));
  assert.equal(store.put("a", tile(5000)), false);
  assert.equal(store.size, 0);
});

test("cleared, nothing is held, and a tile decoded before is refused", () => {
  const store = new DecodedTiles(room(4));
  const before = store.epoch;
  store.put("a", tile(1000));
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.bytes, 0);
  assert.equal(store.put("b", tile(1000), before), false);
  assert.equal(store.has("b"), false);
  assert.equal(store.put("b", tile(1000), store.epoch), true);
});

test("which of a frame's tiles are missing is cheap to ask", () => {
  const store = new DecodedTiles(room(4));
  store.put("a", tile(1000));
  store.put("c", BLANK);
  assert.deepEqual(store.missing(["a", "b", "c", "d"]), ["b", "d"]);
});

test("each tile kept is told, until the listener is let go", () => {
  const store = new DecodedTiles(room(4));
  const heard: string[] = [];
  const stop = store.onPut((key) => heard.push(key));
  store.put("a", tile(1000));
  stop();
  store.put("b", tile(1000));
  assert.deepEqual(heard, ["a"]);
});

test("waiting for a frame's tiles resolves once the last of them is kept", async () => {
  const store = new DecodedTiles(room(4));
  store.put("a", tile(1000));
  let settled: boolean | undefined;
  const waiting = store.whenAll(["a", "b", "c"], 10_000).then((all) => { settled = all; });
  store.put("b", tile(1000));
  await Promise.resolve();
  assert.equal(settled, undefined);
  store.put("c", BLANK);
  await waiting;
  assert.equal(settled, true);
});

test("a frame whose tiles are all kept is ready at once", async () => {
  const store = new DecodedTiles(room(4));
  store.put("a", tile(1000));
  assert.equal(await store.whenAll(["a"], 10_000), true);
  assert.equal(await store.whenAll([], 10_000), true);
});

test("waiting gives up after its time, or when aborted", async () => {
  const store = new DecodedTiles(room(4));
  assert.equal(await store.whenAll(["a"], 5), false);
  const abort = new AbortController();
  const waiting = store.whenAll(["a"], 10_000, abort.signal);
  abort.abort();
  assert.equal(await waiting, false);
  // Neither left a listener behind to be told.
  store.put("a", tile(1000));
});

test("the mean cost of a tile is known once enough are held", () => {
  const store = new DecodedTiles(room(64));
  for (let i = 0; i < 15; i++) store.put(`t${i}`, BLANK);
  assert.equal(store.meanCost(), undefined);
  store.put("t15", tile(1000));
  assert.equal(store.meanCost(), ENTRY_OVERHEAD + 1000 / 16);
});
