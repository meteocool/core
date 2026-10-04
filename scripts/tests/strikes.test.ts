import assert from "node:assert/strict";
import test from "node:test";
import Cluster from "ol/source/Cluster.js";
import { get as getProjection } from "ol/proj.js";
import type Feature from "ol/Feature.js";

const { default: StrikeSource } = await import("../../src/layers/strikeSource.ts");
const { default: StrikeManager, LIVE_STRIKE_BATCH_MS } = await import("../../src/lib/StrikeManager.ts");
const { coalesce } = await import("../../src/lib/coalesce.ts");
const { default: StrikeManagerV2 } = await import("../../src/lib/StrikeManagerV2.ts");

/**
 * The flat map draws strikes through a Cluster, which reclusters everything
 * on each change of the source under it. The cache's thousand strikes added
 * one at a time were a thousand reclusterings; they have to be one -- and
 * come out as the same clusters, since greedy clustering depends on the
 * order the features are handed over in.
 */

const MIN = 60 * 1000;

/** A source as App.svelte builds it, already drawn once, counting changes and clusterings. */
function strikeSource() {
  const source = new StrikeSource();
  const cluster = new Cluster({ distance: 8, source });
  // A cluster source does nothing until it is drawn at some resolution.
  cluster.loadFeatures([-2e6, -2e6, 2e6, 2e6], 500, getProjection("EPSG:3857")!);
  let changes = 0;
  let clusterings = 0;
  source.on("change", () => { changes += 1; });
  const target = cluster as unknown as { cluster: () => void };
  const recluster = target.cluster.bind(cluster);
  target.cluster = () => { clusterings += 1; recluster(); };
  return {
    source,
    changes: () => changes,
    clusterings: () => clusterings,
    ids: () => source.getFeatures().map((f) => f.getId() as number).sort((a, b) => a - b),
    clusters: () => cluster.getFeatures()
      .map((c) => (c.get("features") as Feature[]).map((f) => f.getId()).sort().join("|"))
      .sort(),
  };
}

/** Strikes close enough together for some of them to cluster. */
const strikes = (times: number[]) => times.map((time, i) => ({ lon: (i % 37) * 2500, lat: (i % 23) * 2500, time }));

test("a thousand strikes are one change and one clustering, not a thousand", () => {
  const s = strikeSource();
  const manager = new StrikeManager(1000, s.source);
  const now = Date.now();
  manager.addStrikes(strikes(Array.from({ length: 1000 }, (_, i) => now - i)));
  assert.equal(s.source.getFeatures().length, 1000);
  assert.equal(s.changes(), 1);
  assert.equal(s.clusterings(), 1);
});

test("the batch draws the same clusters as adding the strikes one by one", () => {
  const now = Date.now();
  // Duplicate times as well, which the cache does send: the source keeps the
  // first strike under an id either way.
  const times = Array.from({ length: 600 }, (_, i) => now - Math.floor(i / 2) * 7);
  const batched = strikeSource();
  const oneByOne = strikeSource();
  new StrikeManager(1000, batched.source).addStrikes(strikes(times));
  const manager = new StrikeManager(1000, oneByOne.source);
  strikes(times).forEach(({ lon, lat, time }) => manager.addStrikeWithTime(lon, lat, time));
  // One per distinct strike: a repeat is turned away before the source, which
  // announced a change even for a feature it refused.
  assert.equal(oneByOne.clusterings(), 300);
  assert.deepEqual(batched.ids(), oneByOne.ids());
  assert.deepEqual(batched.clusters(), oneByOne.clusters());
  assert.ok(batched.clusters().length < 300, "some strikes clustered");
});

test("the ring buffer still evicts the oldest, within a batch and across them", () => {
  const s = strikeSource();
  const manager = new StrikeManager(5, s.source);
  manager.addStrikes(strikes([1, 2, 3]));
  manager.addStrikes(strikes([4, 5, 6, 7, 8]));
  assert.deepEqual(manager.strikes, [4, 5, 6, 7, 8]);
  assert.deepEqual(s.ids(), [4, 5, 6, 7, 8]);
  assert.equal(s.changes(), 2);
});

test("a live strike is still added, and drawn, on its own", () => {
  const s = strikeSource();
  const manager = new StrikeManager(1000, s.source);
  manager.addStrike(1, 2);
  assert.equal(s.source.getFeatures().length, 1);
  const point = s.source.getFeatures()[0].getGeometry() as unknown as { getCoordinates(): number[] };
  assert.deepEqual(point.getCoordinates(), [1, 2]);
  assert.equal(s.changes(), 1);
  assert.equal(s.clusterings(), 1);
});

test("fading takes every strike older than half an hour out in one change", () => {
  const s = strikeSource();
  const manager = new StrikeManager(1000, s.source);
  const now = Date.now();
  manager.addStrikes(strikes([now - 40 * MIN, now - 35 * MIN, now - 20 * MIN, now - 31 * MIN, now - MIN]));
  const before = s.changes();
  manager.fadeStrikes();
  assert.deepEqual(s.ids(), [now - 20 * MIN, now - MIN]);
  assert.deepEqual(manager.strikes, [now - 20 * MIN, now - MIN]);
  assert.equal(s.changes() - before, 1);
  // Nothing to fade still redraws, as it did.
  manager.fadeStrikes();
  assert.equal(s.changes() - before, 2);
});

test("a disabled manager adds nothing, and announces nothing", () => {
  const s = strikeSource();
  const manager = new StrikeManager(1000, s.source);
  manager.enable(false);
  const before = s.changes();
  manager.addStrikes(strikes([1, 2, 3]));
  assert.equal(manager.addStrikeWithTime(0, 0, 4), false);
  assert.equal(s.source.getFeatures().length, 0);
  assert.equal(s.changes(), before);
});

test("a batch that throws still announces what it did", () => {
  const s = strikeSource();
  assert.throws(() => s.source.batch(() => {
    new StrikeManager(10, s.source).addStrikes(strikes([1, 2]));
    throw new Error("halfway");
  }));
  assert.equal(s.changes(), 1);
  assert.deepEqual(s.ids(), [1, 2]);
});

test("the lightning map's backfill is one change, skips what it has, and the baseline evicts in one", () => {
  const source = new StrikeSource();
  let changes = 0;
  source.on("change", () => { changes += 1; });
  const manager = new StrikeManagerV2(source, 0);
  manager.addStrike(0, 0, 5);
  manager.addStrikes([10, 20, 5, 30, 10].map((timestamp) => ({ lon: 0, lat: 0, timestamp })));
  assert.equal(source.getFeatures().length, 4);
  assert.equal(changes, 2);
  manager.setBaseline(15);
  assert.deepEqual(source.getFeatures().map((f) => f.get("time_wall_ns") as number).sort((a, b) => a - b), [20, 30]);
  assert.equal(changes, 3);
});

/**
 * Live strikes arrive one socket event at a time. Each on its own was a
 * recluster and a redraw of the whole map; gathered for a moment they are one
 * of each, whatever the storm is doing.
 */
test("live strikes that arrive together are one change and one clustering", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = strikeSource();
  const manager = new StrikeManager(1000, s.source);
  const live = coalesce((items: { lon: number; lat: number; time: number }[]) => manager.addLiveStrikes(items), LIVE_STRIKE_BATCH_MS);
  const now = Date.now();
  strikes(Array.from({ length: 40 }, (_, i) => now - i)).forEach((strike) => live.push(strike));
  assert.equal(s.changes(), 0);
  t.mock.timers.tick(LIVE_STRIKE_BATCH_MS);
  assert.equal(s.source.getFeatures().length, 40);
  assert.equal(s.changes(), 1);
  assert.equal(s.clusterings(), 1);
  // The next strike opens a new window rather than riding on the last one.
  live.push(strikes([now + 1])[0]);
  t.mock.timers.tick(LIVE_STRIKE_BATCH_MS - 1);
  assert.equal(s.changes(), 1);
  t.mock.timers.tick(1);
  assert.equal(s.changes(), 2);
});

test("a feed taken down drops the strikes it was holding", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flushed: number[][] = [];
  const live = coalesce((items: number[]) => flushed.push(items), 100);
  live.push(1);
  live.cancel();
  t.mock.timers.tick(100);
  assert.deepEqual(flushed, []);
});

test("a repeated strike does not hold a slot in the ring buffer", () => {
  const s = strikeSource();
  const manager = new StrikeManager(3, s.source);
  // The feed repeats about one strike in ten. Counted twice, the repeat's
  // slot was evicted first and took the strike's only feature with it.
  manager.addLiveStrikes(strikes([1000, 1000, 2000, 3000]));
  assert.deepEqual(manager.strikes, [1000, 2000, 3000]);
  assert.deepEqual(s.ids(), [1000, 2000, 3000]);
});
