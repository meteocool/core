import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import { archiveWindow, frameRequest } from "../../src/stores.ts";
import { followLinkedFrames, requestOnWindow, requestedStep, type RequestGrid } from "../../src/lib/linkedFrame.ts";

const PAST = { start: 1_800_000_000, end: 1_800_007_200 };
const STEP = 300;

/** A grid with a frame on every step of `past` but those in `missing`. */
function windowGrid(past = PAST, missing: number[] = []): RequestGrid {
  const grid: RequestGrid["grid"] = {};
  for (let t = past.start; t <= past.end; t += STEP) grid[t] = missing.includes(t) ? null : { url: `/${t}` };
  return { grid, window: past };
}

test("into a window: the frame asked for if it is in it, else its end; out of one, live", () => {
  assert.equal(requestOnWindow(PAST, PAST.start + STEP), PAST.start + STEP);
  assert.equal(requestOnWindow(PAST, null), PAST.end);
  assert.equal(requestOnWindow(PAST, PAST.end + STEP), PAST.end);
  assert.equal(requestOnWindow(PAST, "live"), PAST.end);
  assert.equal(requestOnWindow(null, PAST.start), "live");
});

test("a request waits for the grid of the window the map is in", () => {
  const live: RequestGrid = { grid: { [PAST.end]: { url: "/x" } }, window: null };
  assert.equal(requestedStep(PAST.start, undefined, PAST, PAST.end), undefined);
  assert.equal(requestedStep(PAST.start, live, PAST, PAST.end), undefined);
  assert.equal(requestedStep(null, windowGrid(), PAST, PAST.end), undefined);
});

test("in a window, the step asked for, or the frame before a missed scan", () => {
  const t = PAST.start + 6 * STEP;
  assert.equal(requestedStep(t, windowGrid(), PAST, PAST.end), t);
  assert.equal(requestedStep(PAST.end, windowGrid(), PAST, PAST.end), PAST.end);
  assert.equal(requestedStep(t, windowGrid(PAST, [t]), PAST, PAST.end), t - STEP);
});

test("on the live grid, a held frame other than the newest; else nothing to move to", () => {
  const newest = 2_000_000_000;
  const live: RequestGrid = { grid: { [newest - STEP]: { url: "/a" }, [newest]: { url: "/b" } }, window: null };
  assert.equal(requestedStep(newest - STEP, live, null, newest), newest - STEP);
  assert.equal(requestedStep(newest, live, null, newest), null);
  assert.equal(requestedStep(newest - 10 * STEP, live, null, newest), null);
  assert.equal(requestedStep("live", live, null, newest), null);
});

test("without the player, a link's window opens on its frame once the window's grid lands", () => {
  const shown: number[] = [];
  let observer: ((subject: string, body: unknown) => void) | null = null;
  const radar = {
    clientGridConfig: { grid: { 1: { url: "/live" } }, window: null } as RequestGrid,
    getMostRecentObservation: () => (radar.clientGridConfig.window ? radar.clientGridConfig.window.end : 1),
    setSource: (step: number) => shown.push(step),
    addObserver: (cb: (subject: string, body: unknown) => void) => { observer = cb; },
  };
  const stop = followLinkedFrames(radar);
  try {
    // As lib/urlState.ts opens a link: the window, then the frame in it.
    const t = PAST.start + 18 * STEP;
    archiveWindow.set(PAST);
    frameRequest.set(t);
    // The live grid is still in hand: nothing is taken from it.
    assert.deepEqual(shown, []);
    assert.equal(get(frameRequest), t);
    radar.clientGridConfig = windowGrid();
    observer!("grid", radar.clientGridConfig);
    assert.deepEqual(shown, [t]);
    assert.equal(get(frameRequest), null);
    // Without a frame named, the window's end.
    archiveWindow.set({ start: PAST.start - 3600, end: PAST.end - 3600 });
    radar.clientGridConfig = windowGrid(get(archiveWindow)!);
    observer!("grid", radar.clientGridConfig);
    assert.deepEqual(shown, [t, PAST.end - 3600]);
    // Leaving it: the radar's own way back to live, nothing set here.
    archiveWindow.set(null);
    radar.clientGridConfig = { grid: { 1: { url: "/live" } }, window: null };
    observer!("grid", radar.clientGridConfig);
    assert.deepEqual(shown, [t, PAST.end - 3600]);
    assert.equal(get(frameRequest), null);
  } finally {
    stop();
    archiveWindow.set(null);
    frameRequest.set(null);
  }
});
