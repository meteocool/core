import assert from "node:assert/strict";
import test from "node:test";
import { isStreamedPath, parseRange, withByteRange } from "../../worker/ranges.ts";

/** Safari streams the soundtrack only from a server that answers `Range` with 206. */

const FILE = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const whole = () => new Response(FILE, { status: 200, headers: { "Content-Type": "audio/mpeg", "Content-Length": "100" } });
const asking = (range?: string, method = "GET") =>
  new Request("https://meteocool.test/audio/menu.mp3", { method, headers: range ? { Range: range } : {} });

test("only the soundtrack is streamed", () => {
  assert.ok(isStreamedPath("/audio/menu.mp3"));
  assert.ok(!isStreamedPath("/assets/index.js"));
  assert.ok(!isStreamedPath("/models/a320/scene.gltf"));
});

test("a range is read as the bytes it asks for, clamped to the file", () => {
  assert.deepEqual(parseRange("bytes=0-", 100), [0, 99]);
  assert.deepEqual(parseRange("bytes=10-19", 100), [10, 19]);
  assert.deepEqual(parseRange("bytes=90-500", 100), [90, 99]);
  assert.deepEqual(parseRange("bytes=-10", 100), [90, 99]);
  assert.deepEqual(parseRange("bytes=-500", 100), [0, 99]);
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=20-10", 100), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(parseRange(null, 100), null);
  assert.equal(parseRange("bytes=0-1,5-6", 100), null);
  assert.equal(parseRange("items=0-1", 100), null);
});

test("a range comes back as 206 with just its bytes", async () => {
  const response = await withByteRange(asking("bytes=10-19"), whole());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 10-19/100");
  assert.equal(response.headers.get("Content-Length"), "10");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test("without a range the whole file, saying ranges are taken", async () => {
  const response = await withByteRange(asking(), whole());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await response.arrayBuffer()).byteLength, 100);
});

test("a range past the end is 416; a missing file stays as it is", async () => {
  const past = await withByteRange(asking("bytes=200-"), whole());
  assert.equal(past.status, 416);
  assert.equal(past.headers.get("Content-Range"), "bytes */100");
  const missing = await withByteRange(asking("bytes=0-"), new Response("not found", { status: 404 }));
  assert.equal(missing.status, 404);
});
