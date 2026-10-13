import assert from "node:assert/strict";
import test from "node:test";
import { drawStorms, forecastCell, isDrawn, nearestOn, selectedMark, stormAsOf } from "../../src/lib/stormMarks.ts";
import { fromStorm, withCell, withDetail } from "../../src/lib/stormSelection.ts";
import { T0, at, cell, detail, sid, storm, trackFeature } from "./stormFixtures.ts";

/**
 * What the flat map draws for the storms in view: the marks KONRAD3D's cells
 * had (path, position, outline, forecast, ellipse, join), for storms. Over
 * Germany a storm with a KONRAD3D primary track draws its forecast when
 * selected; anywhere else it has its track and nothing more.
 */

const A = sid("A");
const B = sid("B");
const now = T0;
const options = { now, reference: now, selection: null, at: null };
const kinds = (marks: { kind: string; storm: string }[], id: string) => marks.filter((m) => m.storm === id).map((m) => m.kind);

const forecast = [
  { t: at(15), lon: 10.3, lat: 50.1, major_km: 5, minor_km: 3, angle_deg: 90 },
  { t: at(30), lon: 10.5, lat: 50.15, major_km: 8, minor_km: 5, angle_deg: 90 },
];

test("an active storm draws its path and its position, and is ringed while live", () => {
  const { marks, pings } = drawStorms([storm(A)], options);
  assert.deepEqual(kinds(marks, A), ["path", "position"]);
  assert.equal(marks.find((m) => m.kind === "position")?.live, true);
  assert.deepEqual(pings.map((p) => p.storm), [A]);
});

test("a storm seen once has no path, only a position", () => {
  const { marks } = drawStorms([storm(A, {}, [[10, 50]])], options);
  assert.deepEqual(kinds(marks, A), ["position"]);
});

test("a storm that ended a while ago is not drawn, unless it is the selected one", () => {
  const ended = storm(A, { status: "ended", last_seen: at(-45) });
  assert.equal(isDrawn(ended, now, null), false);
  assert.equal(isDrawn(ended, now, A), true);
  assert.deepEqual(drawStorms([ended], options).marks, []);
});

test("a storm not seen for a few minutes is drawn but no longer ringed", () => {
  const quiet = storm(A, { last_seen: at(-12) });
  const { marks, pings } = drawStorms([quiet], options);
  assert.equal(marks.find((m) => m.kind === "position")?.live, false);
  assert.deepEqual(pings, []);
});

test("a merged storm keeps its path, joined to the one it merged into, and gives up its position", () => {
  const merged = storm(B, { status: "merged", merged_into: A, last_seen: at(-5) }, [[9.8, 49.9], [9.95, 50]]);
  const survivor = storm(A, {}, [[10, 50], [10.1, 50.05]]);
  const { marks, links, pings } = drawStorms([merged, survivor], options);
  assert.deepEqual(kinds(marks, B), ["path"]);
  assert.deepEqual(pings.map((p) => p.storm), [A]);
  assert.equal(links.length, 1);
  assert.equal(links[0].storm, A);
  assert.equal(links[0].from_storm, B);
  assert.deepEqual(links[0].geometry.coordinates, [[9.95, 50], [10, 50]]);
});

test("a storm merged into one not on the map keeps its position and draws no join", () => {
  const merged = storm(B, { status: "merged", merged_into: A, last_seen: at(-5) });
  const { marks, links } = drawStorms([merged], options);
  assert.deepEqual(kinds(marks, B), ["path", "position"]);
  assert.deepEqual(links, []);
});

test("a join meets the storm it merged into at the vertex nearest its end", () => {
  assert.deepEqual(nearestOn([[0, 0], [1, 0], [2, 0]], [1.2, 0.1]), [1, 0]);
});

test("a branch of a split is joined to where the storm it split from was when it branched off", () => {
  const parent = storm(A, { born_at: at(-60) }, [[10, 50], [10.1, 50], [10.2, 50], [10.3, 50]]);
  const branch = storm(B, { born_at: at(-40), split_from: A }, [[10.12, 50.05], [10.2, 50.1]]);
  const { marks, links } = drawStorms([parent, branch], options);
  assert.deepEqual(kinds(marks, B), ["path", "position"]);
  assert.equal(links.length, 1);
  assert.equal(links[0].storm, B);
  assert.equal(links[0].from_storm, A);
  assert.deepEqual(links[0].geometry.coordinates, [[10.1, 50], [10.12, 50.05]]);
});

test("a branch whose parent is not on the map, or not yet split off, draws no join", () => {
  const parent = storm(A, { born_at: at(-60) }, [[10, 50], [10.3, 50]]);
  const branch = storm(B, { born_at: at(-40), split_from: A }, [[10.12, 50.05], [10.2, 50.1]]);
  assert.deepEqual(drawStorms([branch], options).links, []);
  assert.deepEqual(drawStorms([parent, branch], { ...options, now: T0 - 50 * 60_000, at: T0 - 50 * 60_000 }).links, []);
});

test("the selected KONRAD3D storm draws its forecast and ellipses, with labels on the far end", () => {
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1" });
  const selection = withDetail(fromStorm(of), detail(of, { konrad3d: [trackFeature(cell("C1", { forecast }))] }));
  const { marks } = drawStorms([of], { ...options, selection });
  assert.deepEqual(kinds(marks, A), ["path", "position", "forecast", "ellipse", "forecast", "ellipse"]);
  const ellipse = marks.find((m) => m.kind === "ellipse")!;
  assert.equal(ellipse.lead_minutes, 15);
  assert.equal(ellipse.forecast_at, T0 + 15 * 60_000);
  assert.ok(ellipse.tip![0] > 10.3, "the label sits on the leading edge, east of the centre");
});

test("an unselected storm draws no forecast", () => {
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1" });
  const other = storm(B);
  const selection = withDetail(fromStorm(other), detail(other));
  assert.deepEqual(kinds(drawStorms([of, other], { ...options, selection }).marks, A), ["path", "position"]);
});

test("outside Germany a storm has no forecast, whatever cell it is shown with", () => {
  const of = storm(A, { primary_product: "meteocool/tracker", primary_domain: "fr" });
  const selection = { ...fromStorm(of), cell: cell("C1", { forecast }) };
  assert.equal(forecastCell(selection), null);
  assert.deepEqual(kinds(drawStorms([of], { ...options, selection }).marks, A), ["path", "position"]);
});

test("a cell whose storm is not found yet still draws its forecast as the selection", () => {
  const selection = withCell(null, cell("C1", { forecast }));
  assert.equal(selectedMark(selection), "cell:C1");
  const { marks } = drawStorms([], { ...options, selection });
  assert.deepEqual(marks.map((m) => m.kind), ["forecast", "ellipse", "forecast", "ellipse"]);
});

test("a cell no longer detected draws no forecast", () => {
  assert.equal(forecastCell(withCell(null, cell("C1", { forecast, active: false }))), null);
});

test("the selected storm is drawn from its own copy when the answer leaves it out", () => {
  const selection = fromStorm(storm(A));
  const { marks } = drawStorms([storm(B)], { ...options, selection });
  assert.deepEqual(kinds(marks, A), ["path", "position"]);
});

test("the selected storm's outline is drawn, and only its", () => {
  const ring = [[10, 50], [10.2, 50], [10.2, 50.1], [10, 50]];
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1" });
  const selection = withDetail(fromStorm(of), detail(of, { konrad3d: [trackFeature(cell("C1", { polygon: ring }))] }));
  const { marks } = drawStorms([of, storm(B)], { ...options, selection });
  assert.deepEqual(marks.filter((m) => m.kind === "outline").map((m) => m.storm), [A]);
});

test("hail and rotation ride on every mark of the storm, for the badge", () => {
  const { marks } = drawStorms([storm(A, { hail: true, meso: true })], options);
  assert.ok(marks.every((m) => m.hail && m.meso));
});

test("an earlier frame does not show a storm not yet born", () => {
  assert.equal(stormAsOf(storm(A, { born_at: at(-10) }), T0 - 20 * 60_000), null);
});

test("an earlier frame cuts a storm still going back in proportion, active and unmerged", () => {
  const path = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const merged = storm(A, { born_at: at(-40), last_seen: at(0), status: "merged", merged_into: B }, path);
  const then = stormAsOf(merged, T0 - 20 * 60_000)!;
  assert.deepEqual(then.properties.path.coordinates, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(then.geometry.coordinates, [2, 0]);
  assert.equal(then.properties.status, "active");
  assert.equal(then.properties.merged_into, null);
});

test("an earlier frame shortly after a storm's last sighting shows it still active", () => {
  const ended = storm(A, { born_at: at(-60), last_seen: at(-30), status: "ended" });
  assert.equal(stormAsOf(ended, T0 - 25 * 60_000)!.properties.status, "active");
  assert.equal(stormAsOf(ended, T0)!.properties.status, "ended");
});

test("an earlier frame draws no forecast, even for the selected storm", () => {
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1", born_at: at(-60) });
  const selection = withDetail(fromStorm(of), detail(of, { konrad3d: [trackFeature(cell("C1", { forecast }))] }));
  const { marks } = drawStorms([of], { now: T0 - 10 * 60_000, reference: T0 - 10 * 60_000, selection, at: T0 - 10 * 60_000 });
  assert.ok(!marks.some((m) => m.kind === "forecast" || m.kind === "ellipse"));
});
