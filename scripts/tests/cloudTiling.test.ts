import assert from "node:assert/strict";
import test from "node:test";
import { cameraOf, farToNear, walkOf } from "../../src/lib/drawOrder.ts";
import { FETCH_TRIES, FetchRetries, RETRY_MS } from "../../src/lib/fetchRetries.ts";
import { handOver, overlaps } from "../../src/lib/volumeHandover.ts";
import type { Placed } from "../../src/lib/volumeHandover.ts";
import { fineWithin, footprintOnScreen } from "../../src/lib/volumeLevels.ts";
import type { Bounds } from "../../src/lib/volumeLevels.ts";

/* ---- draw order ---- */

/** Column-major 4x4 product and inverse, as the map's matrices are. */
const multiply = (a: number[], b: number[]) => Array.from({ length: 16 }, (_, i) => {
  const [c, r] = [Math.floor(i / 4), i % 4];
  return [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + r] * b[c * 4 + k], 0);
});
function inverse(m: number[]): number[] {
  // Gauss-Jordan on the row-major transpose, then back.
  const rows = [0, 1, 2, 3].map((r) => [...[0, 1, 2, 3].map((c) => m[c * 4 + r]), ...[0, 1, 2, 3].map((c) => Number(c === r))]);
  for (let col = 0; col < 4; col += 1) {
    const pivot = rows.slice(col).reduce((best, row, i) => (Math.abs(row[col]) > Math.abs(rows[best][col]) ? col + i : best), col);
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    rows[col] = rows[col].map((value) => value / scale);
    for (let r = 0; r < 4; r += 1) {
      if (r === col) continue;
      const factor = rows[r][col];
      rows[r] = rows[r].map((value, c) => value - factor * rows[col][c]);
    }
  }
  return Array.from({ length: 16 }, (_, i) => rows[i % 4][4 + Math.floor(i / 4)]);
}

test("the camera is found from the inverse of the matrix to clip space", () => {
  const [near, far, f] = [0.01, 10, 1 / Math.tan(0.4)];
  const perspective = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  // Looking down from above a point, tilted: a rotation about x, then the camera moved off.
  const tilt = 1.0;
  const rotate = [1, 0, 0, 0, 0, Math.cos(tilt), Math.sin(tilt), 0, 0, -Math.sin(tilt), Math.cos(tilt), 0, 0, 0, 0, 1];
  const eye = [0.52, 0.31, 0.004];
  const move = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1];
  const found = cameraOf(inverse(multiply(perspective, multiply(rotate, move))));
  found.forEach((value, axis) => assert.ok(Math.abs(value - eye[axis]) < 1e-9, `axis ${axis}: ${value}`));
});

test("a tile's walk puts the quarter away from the camera first and the one it is over last", () => {
  const camera = [0.75, 0.75];
  assert.deepEqual(walkOf([1, 0, 0], camera), [0]);
  assert.deepEqual(walkOf([1, 1, 0], camera), [3]);
  assert.deepEqual(walkOf([1, 0, 1], camera), [2]);
  assert.deepEqual(walkOf([1, 1, 1], camera), [4]);
  assert.deepEqual(walkOf([2, 3, 3], camera), [4, 4]);
});

test("two tiles side by side are drawn far then near, whatever their middles' depths say", () => {
  // Looking north, both middles stand equally deep; here they are even the wrong way round.
  const west = { tile: [10, 520, 370], depth: 0.5, name: "west" };
  const east = { tile: [10, 521, 370], depth: 0.6, name: "east" };
  const fromWest = [520.2 / 1024, 371.5 / 1024];
  assert.deepEqual(farToNear([west, east], fromWest).map((cloud) => cloud.name), ["east", "west"]);
  const fromEast = [521.8 / 1024, 371.5 / 1024];
  assert.deepEqual(farToNear([west, east], fromEast).map((cloud) => cloud.name), ["west", "east"]);
});

test("tiles of different sizes and coarse tiles take their place in one walk", () => {
  const camera = [520.5 / 1024, 375 / 1024];
  const clouds = [
    { tile: [11, 1043, 740], depth: 0, name: "fine core, farthest north-east" },
    { tile: [10, 520, 372], depth: 0, name: "tile nearest" },
    { tile: [9, 260, 185], depth: 0, name: "coarse, north" },
    { tile: [10, 521, 372], depth: 0, name: "tile beside" },
  ];
  assert.deepEqual(farToNear(clouds, camera).map((cloud) => cloud.name), [
    "fine core, farthest north-east", "coarse, north", "tile beside", "tile nearest",
  ]);
});

test("where one tile lies in another, or a box has no tile, depth decides", () => {
  const camera = [0.5, 0.5];
  const fr = { tile: [10, 520, 372], depth: 0.4, name: "fr" };
  const ch = { tile: [10, 520, 372], depth: 0.7, name: "ch" };
  const box = { tile: null, depth: 0.9, name: "box" };
  assert.deepEqual(farToNear([fr, ch, box], camera).map((cloud) => cloud.name), ["box", "ch", "fr"]);
});

/* ---- handing over ---- */

const at = (path: string, tile: number[] | null, scan = 100, network = "fr"): Placed => ({ path, network, tile, scan });
const COARSE = at("c", [9, 260, 185]);
const CHILDREN = [at("f0", [10, 520, 370]), at("f1", [10, 521, 370]), at("f2", [10, 520, 371]), at("f3", [11, 1043, 743])];

test("tiles overlap where one lies in the other", () => {
  assert.ok(overlaps([9, 260, 185], [11, 1043, 743]));
  assert.ok(overlaps([10, 520, 370], [10, 520, 370]));
  assert.ok(!overlaps([10, 520, 370], [10, 521, 370]));
  assert.ok(!overlaps([9, 260, 185], [10, 522, 370]));
});

test("a coarse tile stands in until every fine tile in it is in, which wait behind it", () => {
  const [a, b, c, d] = CHILDREN;
  const midway = handOver(CHILDREN, [COARSE, a, b], [c, d]);
  assert.deepEqual([...midway.keep], ["c"]);
  assert.deepEqual([...midway.hide].sort(), ["f0", "f1"]);
  const done = handOver(CHILDREN, [COARSE, a, b, c, d], []);
  assert.equal(done.keep.size, 0);
  assert.equal(done.hide.size, 0);
});

test("fine tiles stand in until the coarse tile over them is in", () => {
  const waiting = handOver([COARSE], CHILDREN, [COARSE]);
  assert.deepEqual([...waiting.keep].sort(), ["f0", "f1", "f2", "f3"]);
  const done = handOver([COARSE], [...CHILDREN, COARSE], []);
  assert.equal(done.keep.size, 0);
  assert.equal(done.hide.size, 0);
});

test("a network's scan stays whole until all of its next scan is in, then turns over at once", () => {
  const old = [at("old-a", [10, 520, 370], 100), at("old-gone", [10, 530, 380], 100)];
  const next = [at("new-a", [10, 520, 370], 400), at("new-b", [10, 521, 370], 400)];
  const other = at("ch", [10, 540, 360], 100, "ch");
  const wanted = [...next, other];
  const midway = handOver(wanted, [...old, next[0], other], [next[1]]);
  // The storm that left still stands, with its scan; the new scan waits.
  assert.deepEqual([...midway.keep].sort(), ["old-a", "old-gone"]);
  assert.deepEqual([...midway.hide], ["new-a"]);
  const done = handOver(wanted, [...old, ...next, other], []);
  assert.equal(done.keep.size, 0);
  assert.equal(done.hide.size, 0);
});

test("a volume panned away from, with nothing on its way in its place, goes at once", () => {
  const { keep } = handOver([at("b", [10, 600, 300])], [at("a", [10, 520, 370])], [at("b", [10, 600, 300])]);
  assert.equal(keep.size, 0);
});

test("another network's tiles never wait for, or hold back, this one's", () => {
  const ch = at("ch", [10, 520, 370], 100, "ch");
  const { keep, hide } = handOver([at("fr", [10, 520, 370], 400)], [ch], [at("fr", [10, 520, 370], 400)]);
  assert.equal(keep.size, 0);
  assert.equal(hide.size, 0);
});

test("stand-ins past the byte limit go, the farthest first", () => {
  const { keep } = handOver([COARSE], CHILDREN, [COARSE], () => 10, 25);
  assert.deepEqual([...keep], ["f0", "f1"]);
});

/* ---- retries ---- */

test("a failed volume is asked for again later each time, then let go of", () => {
  const retries = new FetchRetries();
  retries.failed("a", 0);
  assert.ok(!retries.ready("a", RETRY_MS - 1));
  assert.ok(retries.ready("a", RETRY_MS));
  assert.equal(retries.next(), RETRY_MS);
  retries.failed("a", 10_000);
  assert.equal(retries.next(), 10_000 + 2 * RETRY_MS);
  for (let i = 2; i < FETCH_TRIES; i += 1) retries.failed("a", 20_000);
  assert.ok(retries.givenUp("a"));
  assert.ok(!retries.ready("a", Infinity));
  assert.equal(retries.next(), null);
});

test("a volume that is not there is let go of at once, and a new list forgets the old paths", () => {
  const retries = new FetchRetries();
  retries.failed("gone", 0, true);
  assert.ok(retries.givenUp("gone"));
  retries.failed("other", 0);
  retries.keepOnly(new Set(["other"]));
  assert.ok(!retries.givenUp("gone"));
  assert.ok(retries.ready("never-failed", 0));
});

/* ---- levels ---- */

/** A flat map, a degree to 100 pixels, west 0 and north 10 at the top left. */
const project = ([lon, lat]: [number, number]) => ({ x: lon * 100, y: (10 - lat) * 100 });
const VIEW: Bounds = [0, 0, 10, 10];

test("a tile is on screen by any of its ground, not only its middle", () => {
  // Its middle is off the left edge; its eastern half is not.
  assert.ok(footprintOnScreen([-1, 4, 0.5, 5], VIEW, project, 1000, 1000));
  assert.ok(!footprintOnScreen([-3, 4, -1, 5], VIEW, project, 1000, 1000));
  // Past the map's bounds (beyond the horizon) counts for nothing, wherever it would project.
  assert.ok(!footprintOnScreen([0, 11, 1, 12], VIEW, () => ({ x: 500, y: 500 }), 1000, 1000));
});

test("coarse tiles turn fine largest first, as far as the bytes go", () => {
  const candidates = [
    { code: "small", across: 400, coarseBytes: 10, fineBytes: 30 },
    { code: "large", across: 900, coarseBytes: 10, fineBytes: 60 },
    { code: "middle", across: 600, coarseBytes: 10, fineBytes: 80 },
  ];
  assert.deepEqual([...fineWithin(candidates, 75)].sort(), ["large", "small"]);
  assert.deepEqual([...fineWithin(candidates, 1000)].sort(), ["large", "middle", "small"]);
  assert.equal(fineWithin(candidates, 0).size, 0);
});
