import assert from "node:assert/strict";
import test from "node:test";
import { resolveBaseLayer } from "../../src/lib/baseLayers.ts";
import { LayerManager } from "../../src/lib/LayerManager.ts";

/**
 * The satellite and aerosol maps are gone, but settings and links that name
 * them are not: a stored basemap, a stored capability, a shared link, an app
 * calling window.lm.setTarget. Each falls back to what a new reader gets.
 */

test("a stored satellite basemap follows the colour scheme, like the default", () => {
  assert.equal(resolveBaseLayer("satellite", false), "light");
  assert.equal(resolveBaseLayer("satellite", true), "dark");
  assert.equal(resolveBaseLayer("system", true), "dark");
  assert.equal(resolveBaseLayer(undefined, false), "light");
  assert.equal(resolveBaseLayer("osm", true), "osm");
  assert.equal(resolveBaseLayer("topographic", true), "topographic");
});

const manager = (linked: string | undefined, stored: string) => ({
  options: { initialCapability: linked },
  settings: { get: () => stored },
  capabilities: { radar: {}, lightning: {} },
});

test("a link or stored setting naming a removed map opens the first one instead", () => {
  const start = LayerManager.prototype.startingCapability;
  assert.equal(start.call(manager("satellite", "lightning")), "lightning");
  assert.equal(start.call(manager(undefined, "aerosols")), "radar");
  assert.equal(start.call(manager("aerosols", "satellite")), "radar");
});

test("switching to a removed map leaves the current one up", () => {
  let switched = false;
  const self = {
    capabilities: { radar: { setTarget: () => { switched = true; } } },
    currentCap: "radar",
  };
  LayerManager.prototype.setTarget.call(self, "satellite", "map");
  assert.equal(switched, false);
  assert.equal(self.currentCap, "radar");
});
