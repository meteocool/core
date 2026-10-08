import assert from "node:assert/strict";
import test from "node:test";

/**
 * A link's overlays, held for one page load without becoming the reader's.
 *
 * The trap this guards is the stores that mirror a setting: App.svelte writes
 * every change of `lightningLayerVisible` back through `settings.set`, so the
 * moment a link switches lightning off, the store echoes that straight back --
 * and a naive override would then store it, and the reader's own preference
 * would be gone the next time they opened the site without the link.
 */

/* Settings reads the URL and localStorage directly; the smallest stand-ins. */
const store = new Map<string, string>();
const location = { href: "https://meteocool.com/" };
Object.assign(globalThis, {
  document: { location },
  window: { location, history: { pushState() {} } },
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  },
});

const { default: Settings } = await import("../../src/lib/Settings.ts");
const { applyScreenshotLook } = await import("../../src/lib/screenshot.ts");

function lightning(seen: boolean[] = []) {
  store.clear();
  return new Settings({
    layerLightning: { type: "boolean", default: true, cb: (value) => seen.push(Boolean(value)) },
  });
}

test("an override wins over the stored value, and fires the callback", () => {
  const seen: boolean[] = [];
  const settings = lightning(seen);
  settings.override("layerLightning", false);
  assert.equal(settings.getBoolean("layerLightning"), false);
  assert.deepEqual(seen, [false]);
});

test("the override echoed back by its store is not stored", () => {
  const settings = lightning();
  settings.override("layerLightning", false);
  settings.set("layerLightning", false);
  assert.equal(store.has("layerLightning"), false);
});

test("a reader's own stored choice survives a link that disagrees with it", () => {
  const settings = lightning();
  store.set("layerLightning", "false");
  settings.override("layerLightning", true);
  // The store mirroring the setting says true back. The branch that removes
  // a value reset to its default must not read that as the reader resetting.
  settings.set("layerLightning", true);
  assert.equal(store.get("layerLightning"), "false");
});

test("a different value is the reader choosing, and is theirs from then on", () => {
  const settings = lightning();
  settings.override("layerLightning", true);
  settings.set("layerLightning", false);
  assert.equal(store.get("layerLightning"), "false");
  assert.equal(settings.getBoolean("layerLightning"), false);
  // No longer held: turning it back on is stored like any other choice.
  settings.set("layerLightning", true);
  assert.equal(store.has("layerLightning"), false);
  assert.equal(settings.getBoolean("layerLightning"), true);
});

test("an override of the wrong type, or of an unknown key, is refused", () => {
  const settings = lightning();
  settings.override("layerLightning", "no");
  settings.override("nonsense", true);
  assert.equal(settings.getBoolean("layerLightning"), true);
});

test("screenshot mode is read off the address, and nothing it does is stored", (t) => {
  store.clear();
  location.href = "https://meteocool.com/?latLonZ=50.96%2C10.9%2C8.0&screenshot=yes";
  t.after(() => { location.href = "https://meteocool.com/"; });
  const seen: string[] = [];
  const settings = new Settings({
    layerCells: { type: "boolean", default: true },
    screenshot: { type: "string", default: "no", source: "url", cb: (value) => seen.push(String(value)) },
  });
  // Fired from the constructor, which is when App.svelte hides the chrome.
  assert.deepEqual(seen, ["yes"]);
  assert.equal(settings.get("screenshot"), "yes");
  // App.svelte's way of keeping the cells off for the picture: the store
  // echoes it straight back, and it must not become the reader's.
  settings.override("layerCells", false);
  settings.set("layerCells", false);
  assert.equal(store.size, 0);
});

/**
 * A widget's picture in the reader's basemap and palette. A renderer reuses
 * its browser, so whatever one picture stored would be the next one's
 * default -- and a notification's map would come out in someone's dark mode.
 */
test("a picture's basemap and palette drive the settings without being stored", () => {
  store.clear();
  const seen: string[] = [];
  const settings = new Settings({
    mapBaseLayer: { type: "string", default: "system", cb: (value) => seen.push(`base:${value}`) },
    radarColorMapping: { type: "string", default: "classic", cb: (value) => seen.push(`cmap:${value}`) },
  });
  applyScreenshotLook(settings, "?screenshot=yes&baseLayer=dark&colormap=homeyer");
  assert.deepEqual(seen, ["base:dark", "cmap:homeyer"]);
  assert.equal(settings.get("mapBaseLayer"), "dark");
  assert.equal(settings.get("radarColorMapping"), "homeyer");
  // The stores mirroring them echo the values back; still nothing is stored.
  settings.set("mapBaseLayer", "dark");
  settings.set("radarColorMapping", "homeyer");
  assert.equal(store.size, 0);
});

test("a picture asked for nothing, or for something unknown, leaves the settings alone", () => {
  store.clear();
  store.set("mapBaseLayer", "osm");
  const seen: string[] = [];
  const settings = new Settings({
    mapBaseLayer: { type: "string", default: "system", cb: (value) => seen.push(String(value)) },
    radarColorMapping: { type: "string", default: "classic", cb: (value) => seen.push(String(value)) },
  });
  seen.length = 0;
  applyScreenshotLook(settings, "?screenshot=yes&baseLayer=system&colormap=rainbow");
  assert.deepEqual(seen, []);
  assert.equal(settings.get("mapBaseLayer"), "osm");
  assert.equal(settings.get("radarColorMapping"), "classic");
});

/**
 * A webview without storage, where `localStorage` is null, or a browser that
 * blocks it: set() threw, and the switch the reader had just flipped did
 * nothing.
 */
test("without storage, a setting still changes, for this page load", (t) => {
  const real = (globalThis as Record<string, unknown>).localStorage;
  t.after(() => { (globalThis as Record<string, unknown>).localStorage = real; });
  const seen: boolean[] = [];
  const settings = lightning(seen);
  (globalThis as Record<string, unknown>).localStorage = null;
  assert.doesNotThrow(() => settings.set("layerLightning", false));
  assert.equal(settings.getBoolean("layerLightning"), false);
  assert.deepEqual(seen, [false]);
  settings.set("layerLightning", true);
  assert.equal(settings.getBoolean("layerLightning"), true);
  assert.deepEqual(seen, [false, true]);
});
