import assert from "node:assert/strict";
import test from "node:test";
import type { CellStep, CellTrackProperties } from "../../src/api/index.ts";
import { anchorAt, buildCellLinks, supersededCodes } from "../../src/lib/cellLinks.ts";

/**
 * Splits and merges, as the map has to draw them.
 *
 * DWD ends a cell's code at either event and starts new ones, so the lineage
 * is the only thing that says the storm carried on. Two failures follow from
 * ignoring it, and these are the tests for both: a track drawn in pieces with
 * gaps where the storm divided or joined, and the cell that has been taken
 * over left sitting on the map beside the one that took over from it.
 */

const minute = (m: number) => new Date(Date.UTC(2026, 8, 20, 16, m)).toISOString();

const step = (m: number, lon: number, lat: number): CellStep => ({
  t: minute(m),
  lon,
  lat,
  identifier: 1,
  severity: 1,
  gust_flag: 0,
  hail_flag: 0,
  heavy_rain_flag: 0,
  merge: false,
  split: false,
});

const cell = (
  code: string,
  series: CellStep[],
  extra: Partial<CellTrackProperties> = {},
): CellTrackProperties => ({
  code,
  active: true,
  first_seen: series[0].t,
  last_seen: series[series.length - 1].t,
  max_severity: 1,
  hail_ever: false,
  hail_minutes: 0,
  meso_ever: false,
  meso_minutes: 0,
  intensifying: false,
  lightning_jump_recent: false,
  merge_ever: false,
  split_ever: false,
  n_steps: series.length,
  series,
  ...extra,
});

const drawn = (...tracks: CellTrackProperties[]) => new Map(tracks.map((t) => [t.code, t]));

/* ---- where a join is anchored on the parent ------------------------------ */

test("the anchor is where the parent was when the child appeared", () => {
  const series = [step(0, 10, 48), step(5, 11, 48), step(10, 12, 48)];
  assert.deepEqual(anchorAt(series, Date.parse(minute(5))), [11, 48]);
});

test("a child born between two detections takes the one before it", () => {
  const series = [step(0, 10, 48), step(5, 11, 48), step(10, 12, 48)];
  assert.deepEqual(anchorAt(series, Date.parse(minute(7))), [11, 48]);
});

test("a child born after the parent ended takes the parent's last position", () => {
  const series = [step(0, 10, 48), step(5, 11, 48)];
  assert.deepEqual(anchorAt(series, Date.parse(minute(40))), [11, 48]);
});

test("a parent whose own history starts later still anchors somewhere real", () => {
  // `trimToLastRun` can cut a glued start off a parent and not off its child.
  const series = [step(20, 14, 48), step(25, 15, 48)];
  assert.deepEqual(anchorAt(series, Date.parse(minute(0))), [14, 48]);
});

test("a parent with no series has nowhere to anchor", () => {
  assert.equal(anchorAt([], Date.parse(minute(0))), null);
});

/* ---- the joins ----------------------------------------------------------- */

test("a split joins the parent to each child, from where the parent then was", () => {
  const parent = cell("P", [step(0, 10, 48), step(5, 11, 48), step(10, 12, 48)], {
    child_codes: ["A", "B"],
    split_ever: true,
  });
  const a = cell("A", [step(5, 11.1, 48.1), step(10, 12.1, 48.2)], { parent_codes: ["P"] });
  const b = cell("B", [step(5, 11.1, 47.9), step(10, 12.1, 47.8)], { parent_codes: ["P"] });

  const links = buildCellLinks(drawn(parent, a, b));

  assert.equal(links.length, 2);
  // Both leave the parent where it was at 16:05, not where it ended at 16:10:
  // a parent that keeps running past the split would otherwise be joined to
  // its children by a line running backwards across its own track.
  links.forEach((link) => assert.deepEqual(link.start, [11, 48]));
  assert.deepEqual(links.map((link) => link.to).sort(), ["A", "B"]);
  assert.deepEqual(
    links.find((link) => link.to === "A")?.end,
    [11.1, 48.1],
  );
});

test("a merge joins each parent to the cell they became", () => {
  const first = cell("P1", [step(0, 10, 48), step(5, 11, 48)], { child_codes: ["C"] });
  const second = cell("P2", [step(0, 10, 47.6), step(5, 11, 47.8)], { child_codes: ["C"] });
  const child = cell("C", [step(10, 11.6, 47.9)], {
    parent_codes: ["P1", "P2"],
    merge_ever: true,
  });

  const links = buildCellLinks(drawn(first, second, child));

  assert.equal(links.length, 2);
  assert.deepEqual(links.map((link) => link.from).sort(), ["P1", "P2"]);
  links.forEach((link) => assert.deepEqual(link.end, [11.6, 47.9]));
  assert.deepEqual(links.find((link) => link.from === "P2")?.start, [11, 47.8]);
});

test("a relationship recorded at both ends is still one join", () => {
  const parent = cell("P", [step(0, 10, 48)], { child_codes: ["C"] });
  const child = cell("C", [step(5, 10.2, 48)], { parent_codes: ["P"] });

  assert.equal(buildCellLinks(drawn(parent, child)).length, 1);
});

test("a relative that is not on the map is not joined to", () => {
  const child = cell("C", [step(5, 10.2, 48)], { parent_codes: ["OFFSCREEN"] });

  assert.deepEqual(buildCellLinks(drawn(child)), []);
});

/* ---- the cell that was taken over ---------------------------------------- */

test("an ended cell whose continuation is drawn is superseded", () => {
  const parent = cell("P", [step(0, 10, 48), step(5, 11, 48)], {
    active: false,
    child_codes: ["C"],
  });
  const child = cell("C", [step(10, 11.5, 48)], { parent_codes: ["P"] });

  assert.deepEqual([...supersededCodes(drawn(parent, child))], ["P"]);
});

test("a cell still being detected is never superseded", () => {
  // A split leaves the parent running often enough that this is the common
  // case, and hiding a live storm is the one mistake worth never making.
  const parent = cell("P", [step(0, 10, 48), step(10, 12, 48)], { child_codes: ["C"] });
  const child = cell("C", [step(10, 12.1, 48.1)], { parent_codes: ["P"] });

  assert.deepEqual([...supersededCodes(drawn(parent, child))], []);
});

test("a continuation that is not on the map does not hide anything", () => {
  const parent = cell("P", [step(0, 10, 48)], { active: false, child_codes: ["C"] });

  assert.deepEqual([...supersededCodes(drawn(parent))], []);
});

test("a child that ended before its parent did is not a hand-over", () => {
  const parent = cell("P", [step(0, 10, 48), step(30, 13, 48)], {
    active: false,
    child_codes: ["C"],
  });
  const child = cell("C", [step(5, 10.2, 48.1), step(10, 10.4, 48.2)], {
    active: false,
    parent_codes: ["P"],
  });

  assert.deepEqual([...supersededCodes(drawn(parent, child))], []);
});

test("a cell that simply dissipated keeps its mark", () => {
  const gone = cell("P", [step(0, 10, 48)], { active: false });

  assert.deepEqual([...supersededCodes(drawn(gone))], []);
});
