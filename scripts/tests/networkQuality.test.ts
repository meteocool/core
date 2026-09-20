import assert from "node:assert/strict";
import test from "node:test";
import { readNetworkStatus, type NavigatorLike } from "../../src/lib/networkQuality.ts";

/**
 * How isSlow is decided was the part nobody covered: the banner's own predicate
 * had tests, but they were handed an isSlow that had already been worked out,
 * so the thresholds that actually kept the banner up were never exercised.
 */
const nav = (connection: Record<string, unknown> | null, onLine = true): NavigatorLike => ({
  onLine,
  ...(connection === null ? {} : { connection: connection as never }),
});

test("a browser with no Network Information API is not slow", () => {
  assert.deepEqual(readNetworkStatus(nav(null)), {
    online: true,
    effectiveType: null,
    isSlow: false,
  });
});

test("no navigator at all reads as online and not slow", () => {
  assert.deepEqual(readNetworkStatus(undefined), {
    online: true,
    effectiveType: null,
    isSlow: false,
  });
});

test("slow-2g and 2g are slow", () => {
  for (const effectiveType of ["slow-2g", "2g"]) {
    assert.equal(readNetworkStatus(nav({ effectiveType })).isSlow, true, effectiveType);
  }
});

test("3g is not slow", () => {
  // The bucket anything past ~270ms of round trip lands in. Treating it as slow
  // is what left the banner up permanently on an ordinary connection.
  assert.equal(readNetworkStatus(nav({ effectiveType: "3g" })).isSlow, false);
});

test("4g is not slow", () => {
  assert.equal(readNetworkStatus(nav({ effectiveType: "4g" })).isSlow, false);
});

test("a low downlink estimate on its own is not slow", () => {
  // downlink reports recently observed throughput, not capacity, so it reads
  // low whenever the page has been idle or served from cache.
  assert.equal(readNetworkStatus(nav({ effectiveType: "4g", downlink: 0.4 })).isSlow, false);
});

test("saveData is slow whatever the effective type says", () => {
  assert.equal(readNetworkStatus(nav({ effectiveType: "4g", saveData: true })).isSlow, true);
});

test("effectiveType is reported through untouched", () => {
  assert.equal(readNetworkStatus(nav({ effectiveType: "3g" })).effectiveType, "3g");
});

test("offline is read from navigator.onLine", () => {
  assert.equal(readNetworkStatus(nav({ effectiveType: "4g" }, false)).online, false);
  assert.equal(readNetworkStatus(nav({ effectiveType: "4g" }, true)).online, true);
});

test("a navigator without onLine counts as online", () => {
  assert.equal(readNetworkStatus({}).online, true);
});
