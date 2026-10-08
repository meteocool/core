import assert from "node:assert/strict";
import test from "node:test";
import {
  isScreenshot, screenshotLook, screenshotRequested, SCREENSHOT_FALLBACK_MS, whenDrawn,
} from "../../src/lib/screenshot.ts";
import type { DrawnMap, ReadyReason } from "../../src/lib/screenshot.ts";

/**
 * A renderer photographs the page the moment it says it is finished, so a
 * signal that comes early is a card with an empty sky, and one that never
 * comes is a card that times out.
 */

/** A map that draws when told to, firing whatever is listening once. */
function fakeMap() {
  const listeners = new Map<string, (() => void)[]>();
  let renders = 0;
  const fire = (type: string) => {
    const waiting = listeners.get(type) ?? [];
    listeners.delete(type);
    waiting.forEach((listener) => listener());
  };
  const map: DrawnMap = {
    render: () => { renders += 1; },
    once: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  return {
    map,
    fire,
    /** One whole frame: drawn, then judged complete. */
    frame: () => { fire("postrender"); fire("rendercomplete"); },
    renders: () => renders,
  };
}

/** Let the promise callbacks queued so far run. */
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

test("only the literal yes asks for screenshot mode, as with toolbar", () => {
  assert.equal(isScreenshot("yes"), true);
  for (const value of ["no", "", "true", "1", "YES", null, undefined, true]) {
    assert.equal(isScreenshot(value), false, String(value));
  }
});

test("the entrypoint reads the same switch off the address", () => {
  assert.equal(screenshotRequested("https://meteocool.com/?latLonZ=50.96%2C10.9%2C8.0&screenshot=yes"), true);
  assert.equal(screenshotRequested("https://meteocool.com/?screenshot=no"), false);
  assert.equal(screenshotRequested("https://meteocool.com/?toolbar=no&logo=none"), false);
});

test("a picture may be asked for a basemap and a palette", () => {
  assert.deepEqual(
    screenshotLook("?latLonZ=48.1%2C11.5%2C9.5&screenshot=yes&baseLayer=dark&colormap=viridis"),
    { baseLayer: "dark", colormap: "viridis" },
  );
  assert.deepEqual(screenshotLook("?baseLayer=cyclosm"), { baseLayer: "cyclosm" });
  assert.deepEqual(screenshotLook("?colormap=pyart_stepseq"), { colormap: "pyart_stepseq" });
  // The old name the factory still draws as the light basemap.
  assert.deepEqual(screenshotLook("?baseLayer=topographic"), { baseLayer: "topographic" });
});

test("without either, or with one it does not know, a picture keeps the defaults", () => {
  assert.deepEqual(screenshotLook("?latLonZ=48.1%2C11.5%2C9.5&screenshot=yes"), {});
  // "system" is the caller's to resolve: a renderer's colour scheme is nobody's.
  for (const value of ["system", "satellite", "Dark", "", "dark,osm"]) {
    assert.deepEqual(screenshotLook(`?baseLayer=${encodeURIComponent(value)}`), {}, value);
  }
  for (const value of ["rainbow", "NWS", "", "classic "]) {
    assert.deepEqual(screenshotLook(`?colormap=${encodeURIComponent(value)}`), {}, value);
  }
});

test("a map complete before its radar arrived is not the picture", async () => {
  const { map, frame, fire } = fakeMap();
  const seen: ReadyReason[] = [];
  let answer!: () => void;
  whenDrawn(map, new Promise<void>((resolve) => { answer = resolve; }), (reason) => seen.push(reason), 60_000);

  // The basemap alone, drawn and done while the frame list is still out.
  frame();
  fire("rendercomplete");
  assert.deepEqual(seen, []);

  answer();
  await settle();
  frame();
  assert.deepEqual(seen, ["rendered"]);
});

test("a verdict on a frame drawn before the radar's layers were added does not count", async () => {
  const { map, fire, renders } = fakeMap();
  const seen: ReadyReason[] = [];
  whenDrawn(map, Promise.resolve(), (reason) => seen.push(reason), 60_000);
  await settle();
  assert.equal(renders(), 1, "a frame is asked for once the data is in");

  // The previous frame's rendercomplete, still on its way out.
  fire("rendercomplete");
  assert.deepEqual(seen, []);

  fire("postrender");
  fire("rendercomplete");
  assert.deepEqual(seen, ["rendered"]);
});

test("a radar that failed still gets its basemap photographed", async () => {
  const { map, frame } = fakeMap();
  const seen: ReadyReason[] = [];
  whenDrawn(map, Promise.reject(new Error("timeseries 503")), (reason) => seen.push(reason), 60_000);
  await settle();
  frame();
  assert.deepEqual(seen, ["rendered"]);
});

test("a request that never answers is cut off by the fallback, once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { map, frame } = fakeMap();
  const seen: ReadyReason[] = [];
  whenDrawn(map, new Promise(() => {}), (reason) => seen.push(reason));

  t.mock.timers.tick(SCREENSHOT_FALLBACK_MS - 1);
  assert.deepEqual(seen, []);
  t.mock.timers.tick(1);
  assert.deepEqual(seen, ["timeout"]);

  frame();
  t.mock.timers.tick(SCREENSHOT_FALLBACK_MS);
  assert.deepEqual(seen, ["timeout"]);
});

test("a drawn picture is not declared again when the fallback comes due", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { map, frame } = fakeMap();
  const seen: ReadyReason[] = [];
  whenDrawn(map, Promise.resolve(), (reason) => seen.push(reason));
  await settle();
  frame();
  frame();
  t.mock.timers.tick(SCREENSHOT_FALLBACK_MS);
  assert.deepEqual(seen, ["rendered"]);
});
