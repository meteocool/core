import assert from "node:assert/strict";
import test from "node:test";
import type { CellTrackProperties, CellVolume } from "../../src/api/index.ts";
import { withKnownVolume } from "../../src/lib/cellTrack.ts";

/**
 * A storm's radar volume, kept when a copy of it comes without one.
 *
 * The viewport answer never carries a volume, only the answer for one cell
 * and `/cells/current` do, so an open panel's "Inside" cutaway depends on the
 * map not taking the viewport's copy as the last word on it.
 */

const volume = (scan: string): CellVolume => ({
  path: `meteoradar/volumes/${scan}/de-A.mcvx`,
  coverage: 1,
} as CellVolume);

const copy = (code: string, withVolume: CellVolume | null = null): CellTrackProperties => ({
  code,
  active: true,
  volume: withVolume,
} as unknown as CellTrackProperties);

test("a copy without a volume keeps the one already known for the storm", () => {
  const known = volume("20261011T013000");

  assert.equal(withKnownVolume(copy("A"), copy("A", known)).volume, known);
});

test("a copy that has a volume keeps its own, the newer one", () => {
  const fresh = volume("20261011T013500");
  const next = copy("A", fresh);

  assert.equal(withKnownVolume(next, copy("A", volume("20261011T013000"))), next);
});

test("a copy with nothing known about the storm is left as it came", () => {
  const next = copy("A");

  assert.equal(withKnownVolume(next), next);
  assert.equal(withKnownVolume(next, undefined, null), next);
});

test("another storm's volume is never borrowed", () => {
  assert.equal(withKnownVolume(copy("A"), copy("B", volume("20261011T013000"))).volume, null);
});

test("a known copy without a volume does not hide a later one that has it", () => {
  const known = volume("20261011T013000");

  assert.equal(withKnownVolume(copy("A"), copy("A"), copy("A", known)).volume, known);
});

test("the first known copy with a volume is the one kept", () => {
  const held = volume("20261011T013000");

  assert.equal(withKnownVolume(copy("A"), copy("A", held), copy("A", volume("20261011T012500"))).volume, held);
});

test("the copy is not changed in place", () => {
  const next = copy("A");
  withKnownVolume(next, copy("A", volume("20261011T013000")));

  assert.equal(next.volume, null);
});
