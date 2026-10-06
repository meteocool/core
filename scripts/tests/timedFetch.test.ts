import assert from "node:assert/strict";
import test from "node:test";
import { isAbort, isTransient, RequestStalled, timedFetch } from "../../src/lib/timedFetch.ts";

/**
 * A request that has stopped moving has to fail, or everything waiting on it
 * waits for good: the loading bar, "Refreshing…", the next refresh. One that
 * is merely slow must not -- a storm's volume on a 2G link is still coming.
 */

const STALL = 40;

/** Stand in for the network: `answer` gets the request's signal, as fetch does. */
function network(answer: (signal: AbortSignal) => Promise<Response>, t: test.TestContext) {
  const real = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => answer(init!.signal!)) as typeof fetch;
  t.after(() => { globalThis.fetch = real; });
}

/** Never answers, until the request is called off. */
const silence = (signal: AbortSignal) => new Promise<Response>((_resolve, reject) => {
  signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

/** A body that sends `chunks`, `gap` ms apart, then goes quiet unless `end`. */
function trickle(chunks: number, gap: number, end: boolean, signal: AbortSignal): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(sink) {
      await new Promise((resolve) => { setTimeout(resolve, gap); });
      if (signal.aborted) {
        sink.error(new DOMException("aborted", "AbortError"));
        return;
      }
      if (sent < chunks) {
        sent += 1;
        sink.enqueue(new Uint8Array([sent]));
      } else if (end) {
        sink.close();
      } else {
        await new Promise((resolve) => { signal.addEventListener("abort", resolve); });
        sink.error(new DOMException("aborted", "AbortError"));
      }
    },
  });
  return new Response(body);
}

test("a request with no answer at all fails as stalled", async (t) => {
  network(silence, t);
  await assert.rejects(timedFetch("https://example.test/a", {}, STALL), RequestStalled);
});

test("a body that stops halfway fails as stalled when it is read", async (t) => {
  network(async (signal) => trickle(2, 5, false, signal), t);
  const response = await timedFetch("https://example.test/b", {}, STALL);
  assert.equal(response.status, 200);
  await assert.rejects(response.arrayBuffer(), RequestStalled);
});

test("a slow body that keeps arriving is never cut off", async (t) => {
  // Ten chunks, each well inside the stall, the whole well beyond it.
  network(async (signal) => trickle(10, STALL / 2, true, signal), t);
  const response = await timedFetch("https://example.test/c", {}, STALL);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("the caller's own abort is an abort, not a stall", async (t) => {
  network(silence, t);
  const controller = new AbortController();
  const pending = timedFetch("https://example.test/d", { signal: controller.signal }, 10_000);
  controller.abort();
  const error = await pending.catch((e) => e);
  assert.ok(isAbort(error));
  assert.ok(!(error instanceof RequestStalled));
});

test("an answer keeps its status and headers", async (t) => {
  network(async () => new Response("nope", { status: 503, headers: { "x-test": "1" } }), t);
  const response = await timedFetch("https://example.test/e", {}, STALL);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-test"), "1");
  assert.equal(await response.text(), "nope");
});

test("what a retry can fix is told apart from what it cannot", () => {
  assert.ok(isTransient(new RequestStalled("u", 1)));
  assert.ok(isTransient(new TypeError("Failed to fetch")));
  assert.ok(!isTransient(new Error("unparseable")));
  for (const status of [408, 429, 500, 502, 503, 504]) assert.ok(isTransient(undefined, status), String(status));
  for (const status of [400, 401, 403, 404]) assert.ok(!isTransient(undefined, status), String(status));
});
