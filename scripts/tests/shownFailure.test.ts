import assert from "node:assert/strict";
import test from "node:test";
import { failureKind } from "../../src/lib/shownFailure.ts";

/**
 * The kinds the "could not be loaded" reports are grouped by in Sentry, so
 * one failure is one issue whatever the browser calls it.
 */

test("every browser's way of saying the network failed is one kind", () => {
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "The network connection was lost.",
  ]) assert.equal(failureKind(new TypeError(message)), "network", message);
});

test("a chunk that will not load is told from the network failing", () => {
  assert.equal(
    failureKind(new TypeError("Failed to fetch dynamically imported module: https://example.org/assets/CellSheet-abc.js")),
    "chunk",
  );
  assert.equal(failureKind(new TypeError("Importing a module script failed.")), "chunk");
  assert.equal(failureKind(new Error("Unable to preload CSS for /assets/x.css")), "chunk");
});

test("an answer with a status is grouped by it", () => {
  const refused = Object.assign(new Error("cells failed (503)"), { status: 503 });
  assert.equal(failureKind(refused), "http-503");
});

test("a stall, WebGL, and everything else", () => {
  assert.equal(failureKind(Object.assign(new Error("x stalled"), { name: "RequestStalled" })), "stalled");
  assert.equal(failureKind(new Error("WebGL2 is not available")), "webgl");
  assert.equal(failureKind(new Error("bad magic")), "other");
  assert.equal(failureKind("a string"), "other");
  assert.equal(failureKind(null), "other");
});

test("with reporting off, a shown failure goes to the console, a few of each kind, never an abort", async (t) => {
  const { reportShown } = await import("../../src/lib/sentry.ts");
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warned.push(args); });
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  reportShown("cappi", abort);
  assert.equal(warned.length, 0);
  for (let i = 0; i < 5; i++) reportShown("cappi", new TypeError("Load failed"), { path: "x" });
  assert.equal(warned.length, 3);
  assert.match(String(warned[0][0]), /cappi, network/);
  reportShown("cappi", new Error("bad magic"));
  assert.equal(warned.length, 4);
});
