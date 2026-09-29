import assert from "node:assert/strict";
import test from "node:test";

/**
 * postToNative reaches whichever host the page runs in, and nothing else.
 *
 * Android builds before 4.0 inject `Android` with requestSettings() only, so a
 * message there must be dropped rather than throw.
 */

const { postToNative } = await import("../../src/lib/nativeBridge.ts");

const globals = globalThis as Record<string, unknown>;

function reset() {
  delete globals.window;
  delete globals.Android;
}

test("iOS gets the message on scriptHandler", () => {
  reset();
  const seen: string[] = [];
  globals.window = { webkit: { messageHandlers: { scriptHandler: { postMessage: (m: string) => seen.push(m) } } } };
  postToNative("layerSwitcherOpened");
  assert.deepEqual(seen, ["layerSwitcherOpened"]);
});

test("Android gets the message on its bridge", () => {
  reset();
  const seen: string[] = [];
  globals.window = {};
  globals.Android = { requestSettings() {}, postMessage: (m: string) => seen.push(m) };
  postToNative("detailSheetExpanded");
  assert.deepEqual(seen, ["detailSheetExpanded"]);
});

test("an Android bridge without postMessage is left alone", () => {
  reset();
  globals.window = {};
  globals.Android = { requestSettings() {} };
  assert.doesNotThrow(() => postToNative("impactLight"));
});

test("a browser has no host to tell", () => {
  reset();
  globals.window = {};
  assert.doesNotThrow(() => postToNative("impactMedium"));
});
