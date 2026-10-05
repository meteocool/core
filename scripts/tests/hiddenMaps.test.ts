import assert from "node:assert/strict";
import test from "node:test";
import BaseObject from "ol/Object";
import type Map from "ol/Map";
import { releaseWhileHidden } from "../../src/lib/hiddenMaps.ts";

/** Just enough of a map: a target that fires `change:target`, and layers that count releases. */
function fakeMap() {
  const map = new BaseObject();
  const released: string[] = [];
  const layers = ["basemap", "radar"].map((name) => ({ clearRenderer: () => released.push(name) }));
  Object.assign(map, {
    getTarget: () => map.get("target"),
    getAllLayers: () => layers,
    frameState_: { postRenderFunctions: [] },
  });
  return { map: map as unknown as Map & BaseObject, released };
}

test("a map off screen long enough lets its layers' renderers go", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { map, released } = fakeMap();
  releaseWhileHidden(map, 1000);
  map.set("target", "map");
  map.set("target", undefined);
  t.mock.timers.tick(999);
  assert.deepEqual(released, []);
  t.mock.timers.tick(1);
  assert.deepEqual(released, ["basemap", "radar"]);
  // Its last frame went too: that frame's callbacks held the renderers.
  assert.equal((map as unknown as { frameState_: unknown }).frameState_, null);
});

test("a map back on screen in time keeps everything", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { map, released } = fakeMap();
  releaseWhileHidden(map, 1000);
  map.set("target", "map");
  map.set("target", undefined);
  t.mock.timers.tick(500);
  map.set("target", "thumbnail");
  t.mock.timers.tick(5000);
  assert.deepEqual(released, []);
});

test("once stopped, a hidden map is left alone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { map, released } = fakeMap();
  const stop = releaseWhileHidden(map, 1000);
  map.set("target", "map");
  map.set("target", undefined);
  stop();
  t.mock.timers.tick(5000);
  assert.deepEqual(released, []);
});
