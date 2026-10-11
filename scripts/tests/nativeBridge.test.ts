import assert from "node:assert/strict";
import test from "node:test";

/**
 * postToNative reaches whichever host the page runs in, and nothing else.
 *
 * Android builds before 4.0 inject `Android` with requestSettings() only, so a
 * message there must be dropped rather than throw.
 */

const { hideNativeControls, holdNativeChrome, postToNative, requestNativeSettings } = await import("../../src/lib/nativeBridge.ts");

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

test("the host hears the first drawer open and the last one close", () => {
  reset();
  const seen: string[] = [];
  globals.window = {};
  globals.Android = { requestSettings() {}, postMessage: (m: string) => seen.push(m) };
  const sheet = holdNativeChrome();
  const panel = holdNativeChrome();
  panel();
  panel();
  assert.deepEqual(seen, ["drawerOpened"]);
  sheet();
  assert.deepEqual(seen, ["drawerOpened", "drawerClosed"]);
  holdNativeChrome()();
  assert.deepEqual(seen, ["drawerOpened", "drawerClosed", "drawerOpened", "drawerClosed"]);
});

test("the controls come back when the last popup hiding them closes, and a drawer is held meanwhile", () => {
  reset();
  const seen: string[] = [];
  globals.window = { webkit: { messageHandlers: { scriptHandler: { postMessage: (m: string) => seen.push(m) } } } };
  const picker = hideNativeControls();
  const menu = hideNativeControls();
  picker();
  picker();
  assert.deepEqual(seen, ["drawerOpened", "hideControls"]);
  menu();
  assert.deepEqual(seen, ["drawerOpened", "hideControls", "drawerClosed", "showControls"]);
});

/**
 * The settings request ends App.svelte's setup, so anything it throws fails
 * the mount and leaves a blank page.
 */
test("each host is asked for its settings its own way", () => {
  reset();
  const ios: string[] = [];
  globals.window = { webkit: { messageHandlers: { scriptHandler: { postMessage: (m: string) => ios.push(m) } } } };
  requestNativeSettings();
  assert.deepEqual(ios, ["requestSettings"]);

  reset();
  let asked = 0;
  globals.window = {};
  globals.Android = { requestSettings() { asked += 1; } };
  requestNativeSettings();
  assert.equal(asked, 1);
});

test("the Android page in a browser, with no bridge injected, asks nobody", () => {
  reset();
  globals.window = {};
  assert.doesNotThrow(() => requestNativeSettings());
});

test("a Java exception on the Android side is reported, not thrown", (t) => {
  reset();
  const reported = t.mock.method(console, "error", () => {});
  globals.window = {};
  const javaException = new Error("Error invoking requestSettings: Java exception was raised during method invocation");
  globals.Android = {
    requestSettings() { throw javaException; },
    postMessage() { throw javaException; },
  };
  assert.doesNotThrow(() => requestNativeSettings());
  assert.doesNotThrow(() => postToNative("drawerOpened"));
  assert.deepEqual(reported.mock.calls.map((call) => call.arguments[0]), [javaException, javaException]);
});
