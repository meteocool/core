import assert from "node:assert/strict";
import test from "node:test";
import { derived, get, writable } from "svelte/store";
import { capLatestObservation, capTimeIndicator, setFrames } from "../../src/stores.ts";
import { showsLatestFrame } from "../../src/lib/freshness.ts";

/**
 * The frame pair, as the cell layer's gate in App.svelte reads it.
 *
 * The gate decides whether a layer that has only a present tense is drawn, and
 * on the way down it drops the open selection -- which closes the storm detail
 * panel. So a single tick in which the pair disagrees is not a flicker that
 * nobody sees: it is a panel that closes itself under the reader. Hence these
 * tests watch every value the gate is handed, not just where it ends up.
 */

/** Every value the gate takes while `run` executes, in order. */
function gateDuring(run: () => void): boolean[] {
  const wanted = writable(true);
  const seen: boolean[] = [];
  const stop = derived(
    [wanted, capTimeIndicator, capLatestObservation],
    ([on, shown, newest]) => on && showsLatestFrame(shown, newest),
  ).subscribe((value) => seen.push(value));
  run();
  stop();
  return seen;
}

test("a live grid refresh never looks like a scrubber off the live edge", () => {
  setFrames({ shown: 1000, newest: 1000 });
  // What `resetToLatest` does when a new observation lands and the player is
  // following it: one update, both halves.
  const seen = gateDuring(() => setFrames({ shown: 1300, newest: 1300 }));
  assert.deepEqual(seen, [true]);
  assert.equal(get(capTimeIndicator), 1300);
  assert.equal(get(capLatestObservation), 1300);
});

test("a grid landing under a parked scrubber does hide the layer", () => {
  setFrames({ shown: 1000, newest: 1000 });
  const seen = gateDuring(() => setFrames({ newest: 1300 }));
  assert.deepEqual(seen, [true, false]);
});

test("republishing the same steps wakes nobody", () => {
  setFrames({ shown: 1300, newest: 1300 });
  const seen = gateDuring(() => setFrames({ newest: 1300 }));
  assert.deepEqual(seen, [true]);
});

test("before any grid there is no frame to disagree with", () => {
  setFrames({ shown: 0, newest: 0 });
  assert.equal(get(capTimeIndicator), 0);
  assert.equal(get(capLatestObservation), 0);
  const seen = gateDuring(() => {});
  assert.deepEqual(seen, [true]);
});
