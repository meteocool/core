import assert from "node:assert/strict";
import test from "node:test";
import { allPreloaded, FramePreloader, slotShare, frameProgress, preloadMode, preloadOrder } from "../../src/lib/framePreload.ts";

/**
 * The timeline's frames fetched ahead for the map in view, and how far each
 * has got, which the timeline draws.
 */

/** A fetch that answers only when told to, recording what was asked. */
function controlledFetch() {
  const pending = new Map<string, (ok: boolean) => void>();
  const asked: string[] = [];
  const fetchTile = (url: string) => new Promise<boolean>((resolve) => {
    asked.push(url);
    pending.set(url, resolve);
  });
  const answer = async (url: string, ok = true) => {
    pending.get(url)!(ok);
    pending.delete(url);
    // Let the preloader's continuation run.
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { fetchTile, asked, pending, answer };
}

const browsingOnWifi = { setting: true, radarShown: true, browsing: true, playing: false, slow: false };

test("a page opened to look at now preloads nothing", () => {
  assert.equal(preloadMode({ ...browsingOnWifi, browsing: false }), "none");
});

test("once the reader moves through frames, every frame is preloaded", () => {
  assert.equal(preloadMode(browsingOnWifi), "all");
  assert.equal(preloadMode({ ...browsingOnWifi, playing: true }), "all");
});

test("on a slow or data-saving connection, only the next frames, only while playing", () => {
  assert.equal(preloadMode({ ...browsingOnWifi, slow: true }), "none");
  assert.equal(preloadMode({ ...browsingOnWifi, slow: true, playing: true }), "ahead");
});

test("with the setting off, or the radar not on screen, nothing is preloaded", () => {
  assert.equal(preloadMode({ ...browsingOnWifi, setting: false, playing: true }), "none");
  assert.equal(preloadMode({ ...browsingOnWifi, radarShown: false, playing: true }), "none");
});

test("frames are fetched nearest the needle first, the later of two as near first", () => {
  assert.deepEqual(preloadOrder([0, 300, 600, 900, 1200], 600), [600, 900, 300, 1200, 0]);
});

test("from either end, the order runs across the whole timeline", () => {
  assert.deepEqual(preloadOrder([0, 300, 600], 0), [0, 300, 600]);
  assert.deepEqual(preloadOrder([0, 300, 600], 600), [600, 300, 0]);
});

test("a frame's progress is the share of its tiles fetched", () => {
  const progress = frameProgress([[0, ["a", "b", "c", "d"]], [300, ["e"]]], new Set(["a", "c"]));
  assert.equal(progress.get(0), 0.5);
  assert.equal(progress.get(300), 0);
});

test("a frame that needs no tiles has nothing left to fetch", () => {
  assert.equal(frameProgress([[0, []]], new Set()).get(0), 1);
});

test("a tile two frames share counts for both", () => {
  const progress = frameProgress([[0, ["a"]], [300, ["a", "b"]]], new Set(["a"]));
  assert.equal(progress.get(0), 1);
  assert.equal(progress.get(300), 0.5);
});

test("only a few tiles are fetched at once, in the plan's order", () => {
  const { fetchTile, asked } = controlledFetch();
  const preloader = new FramePreloader(fetchTile, () => {}, { parallel: 2 });
  preloader.plan([[600, ["a", "b"]], [900, ["c"]], [300, ["d"]]]);
  assert.deepEqual(asked, ["a", "b"]);
});

test("each tile that arrives moves its frame on, and the next is asked for", async () => {
  const { fetchTile, asked, answer } = controlledFetch();
  const reports: Array<Map<number, number>> = [];
  const preloader = new FramePreloader(fetchTile, (progress) => reports.push(progress), { parallel: 1 });
  preloader.plan([[0, ["a", "b"]], [300, ["c"]]]);
  assert.equal(reports.at(-1)!.get(0), 0);

  await answer("a");
  assert.equal(reports.at(-1)!.get(0), 0.5);
  assert.deepEqual(asked, ["a", "b"]);

  await answer("b");
  await answer("c");
  assert.deepEqual([...reports.at(-1)!], [[0, 1], [300, 1]]);
});

test("a new plan replaces what is queued, not what is in flight, and nothing is fetched twice", async () => {
  const { fetchTile, asked, answer } = controlledFetch();
  const preloader = new FramePreloader(fetchTile, () => {}, { parallel: 1 });
  preloader.plan([[0, ["a", "b"]]]);
  await answer("a");
  // "b" is in flight; the map moved, and the frame now needs "a" and "c".
  preloader.plan([[0, ["a", "c"]]]);
  await answer("b");
  await answer("c");
  assert.deepEqual(asked, ["a", "b", "c"]);
});

test("a tile that failed is not asked for again until the next plan", async () => {
  const { fetchTile, asked, answer } = controlledFetch();
  const reports: Array<Map<number, number>> = [];
  const preloader = new FramePreloader(fetchTile, (progress) => reports.push(progress), { parallel: 1 });
  preloader.plan([[0, ["a"]]]);
  await answer("a", false);
  assert.equal(reports.at(-1)!.get(0), 0);
  assert.deepEqual(asked, ["a"]);

  preloader.plan([[0, ["a"]]]);
  assert.deepEqual(asked, ["a", "a"]);
});

test("a fetch that throws counts as failed, not as fetched", async () => {
  const reports: Array<Map<number, number>> = [];
  const preloader = new FramePreloader(() => Promise.reject(new Error("offline")), (progress) => reports.push(progress));
  preloader.plan([[0, ["a"]]]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reports.at(-1)!.get(0), 0);
});

test("while fetching is not allowed (a hidden page), nothing more is asked for", () => {
  const { fetchTile, asked } = controlledFetch();
  const preloader = new FramePreloader(fetchTile, () => {}, { mayFetch: () => false });
  preloader.plan([[0, ["a", "b"]]]);
  assert.deepEqual(asked, []);
});

test("stopped, nothing more is asked for and no frame shows progress", async () => {
  const { fetchTile, asked, answer } = controlledFetch();
  const reports: Array<Map<number, number>> = [];
  const preloader = new FramePreloader(fetchTile, (progress) => reports.push(progress), { parallel: 1 });
  preloader.plan([[0, ["a"]], [300, ["b"]]]);
  preloader.stop();
  assert.equal(reports.at(-1)!.size, 0);
  await answer("a");
  assert.deepEqual(asked, ["a"]);
  assert.equal(reports.at(-1)!.size, 0);
});

test("tiles fetched before stay counted when the plan comes back to them", async () => {
  const { fetchTile, asked, answer } = controlledFetch();
  const reports: Array<Map<number, number>> = [];
  const preloader = new FramePreloader(fetchTile, (progress) => reports.push(progress));
  preloader.plan([[0, ["a"]]]);
  await answer("a");
  preloader.plan([[0, ["b"]]]);
  preloader.plan([[0, ["a"]]]);
  assert.equal(reports.at(-1)!.get(0), 1);
  assert.deepEqual(asked, ["a", "b"]);
});

const step = (t: number, playable = true) => ({ t, playable });

test("the band is whole once every step the needle can reach has all its tiles", () => {
  assert.equal(allPreloaded([step(0), step(300)], new Map([[0, 1], [300, 1]])), true);
  assert.equal(allPreloaded([step(0), step(300)], new Map([[0, 1], [300, 0.9]])), false);
});

test("the unpublished tail does not keep the band from being whole", () => {
  assert.equal(allPreloaded([step(0), step(300, false)], new Map([[0, 1]])), true);
});

test("with nothing preloaded, or no steps, there is no band", () => {
  assert.equal(allPreloaded([step(0)], new Map()), false);
  assert.equal(allPreloaded([], new Map()), false);
});

test("a slot the needle can reach shows its own frame's progress", () => {
  assert.equal(slotShare(step(0), new Map([[0, 0.4]]), false), 0.4);
  assert.equal(slotShare(step(300), new Map(), false), 0);
});

test("the unpublished tail fills only once the band is whole, so the band runs to the end", () => {
  assert.equal(slotShare(step(600, false), new Map(), false), 0);
  assert.equal(slotShare(step(600, false), new Map(), true), 1);
});
