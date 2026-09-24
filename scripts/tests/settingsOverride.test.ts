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
