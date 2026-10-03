import assert from "node:assert/strict";
import test from "node:test";
import VectorSource from "ol/source/Vector.js";

const { default: StrikeManager } = await import("../../src/lib/StrikeManager.ts");

/**
 * A strike is the same strike whether the cache or the socket brought it, and
 * however often the socket sends it: the feed repeats about one strike in ten,
 * a few hundred milliseconds apart, with the same time and place.
 */

/** As /lightning_cache and the `lightning` event carry them: metres, and ms with a fraction. */
const strike = (time: number, lon = 10404.7, lat = 4761278.8) => ({ lon, lat, time });

/** As App.svelte loads the cache. */
function loadCache(manager: InstanceType<typeof StrikeManager>, strikes: ReturnType<typeof strike>[]) {
  strikes.forEach((s) => manager.addStrikeWithTime(s.lon, s.lat, Math.round(s.time)));
}

test("a live strike the cache already holds is not drawn again", () => {
  const source = new VectorSource();
  const manager = new StrikeManager(1000, source);
  loadCache(manager, [strike(1790903026413.3374), strike(1790903027000.25, 20000, 4770000)]);
  manager.addLiveStrike(strike(1790903026413.3374));
  assert.equal(source.getFeatures().length, 2);
});

test("the socket sending a strike twice draws it once", () => {
  const source = new VectorSource();
  const manager = new StrikeManager(1000, source);
  manager.addLiveStrike(strike(1790903026413.3374));
  manager.addLiveStrike(strike(1790903026413.3374));
  assert.equal(source.getFeatures().length, 1);
});

test("a live strike is filed under the time it struck, not when it arrived", () => {
  const source = new VectorSource();
  const manager = new StrikeManager(1000, source);
  const struck = Date.now() - 4000;
  manager.addLiveStrike(strike(struck + 0.4));
  assert.equal(source.getFeatures()[0].getId(), struck);
  assert.deepEqual(manager.strikes, [struck]);
});

test("live strikes still fill and evict the ring buffer in arrival order", () => {
  const source = new VectorSource();
  const manager = new StrikeManager(3, source);
  [1000, 2000, 3000, 4000].forEach((time, i) => manager.addLiveStrike(strike(time, i * 1000)));
  assert.deepEqual(manager.strikes, [2000, 3000, 4000]);
  assert.deepEqual(source.getFeatures().map((f) => f.getId()).sort(), [2000, 3000, 4000]);
});
