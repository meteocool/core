import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import { selectedCell, selectedStorm } from "../../src/stores.ts";
import { fromStorm } from "../../src/lib/stormSelection.ts";
import { stormStatus } from "../../src/lib/stormStatus.ts";
import { cell, sid, storm } from "./stormFixtures.ts";

/**
 * One store, `selectedStorm`, where there were two; `selectedCell` is a view
 * of it for what still speaks in cells (the family chart, the 3D map's tap
 * on an extruded cell, a `cell=` link), and writing it selects through it.
 */

const A = sid("A");
const t = (key: string) => key;

test("setting a cell with nothing open selects it as a seed of its storm", () => {
  selectedStorm.set(null);
  selectedCell.set(cell("C1"));
  const selection = get(selectedStorm);
  assert.equal(selection?.id, null);
  assert.equal(selection?.cell?.code, "C1");
  assert.equal(get(selectedCell)?.code, "C1");
});

test("setting a cell the open storm claims walks within that storm", () => {
  selectedStorm.set(fromStorm(storm(A, { tracks: [{ product: "dwd/konrad3d", domain: "de", track: "C2" }] })));
  selectedCell.set(cell("C2"));
  assert.equal(get(selectedStorm)?.id, A);
  assert.equal(get(selectedCell)?.code, "C2");
});

test("setting null clears the whole selection", () => {
  selectedStorm.set(fromStorm(storm(A)));
  selectedCell.set(null);
  assert.equal(get(selectedStorm), null);
});

test("a storm with no KONRAD3D track reads as no cell", () => {
  selectedStorm.set(fromStorm(storm(A)));
  assert.equal(get(selectedCell), null);
  selectedStorm.set(null);
});

test("a storm's status: merged and ended as the backend says, live until a quarter hour of silence", () => {
  assert.equal(stormStatus({ status: "merged" }, 0, t).kind, "merged");
  assert.equal(stormStatus({ status: "ended" }, 30, t).kind, "ended");
  assert.equal(stormStatus({ status: "active" }, 4, t).kind, "live");
  assert.equal(stormStatus({ status: "active" }, 15, t).kind, "stale");
  assert.equal(stormStatus({ status: "active" }, 4, t).label, "storm.status.live");
});
