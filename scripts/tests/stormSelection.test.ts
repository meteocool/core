import assert from "node:assert/strict";
import test from "node:test";
import {
  byId, claimsCell, fromStorm, headingOf, holdsFeature, isResolution, knowsSeverity, lookupOf, mergedInto,
  nearestStorms, newestPatches, outlineOf, positionOf, primaryCell, selectionKey, stormClaiming, trackerSeries,
  volumeOfStorm, withCell, withDetail, withStorm, withVolume,
} from "../../src/lib/stormSelection.ts";
import {
  at, cell, detail, feature, sid, storm, trackFeature, trackerTrack, volume,
} from "./stormFixtures.ts";

/**
 * One selection, a storm, whichever of a storm, a KONRAD3D cell or a box of
 * sky was tapped. A cell or a box opens at once as a seed and
 * is found in its storm later; the rules for what survives that, and what a
 * walk through a family or a refresh keeps, are these.
 */

const A = sid("A");
const B = sid("B");
const claimed = (id: string, code: string) => storm(id, {
  tracks: [{ product: "dwd/konrad3d", domain: "de", track: code }],
});

test("a storm tapped on the map is selected by its id, with nothing else known yet", () => {
  const selection = fromStorm(storm(A));
  assert.equal(selection.id, A);
  assert.equal(selection.detail, null);
  assert.equal(selection.cell, null);
  assert.equal(selectionKey(selection), `storm:${A}`);
});

test("a cell tapped with nothing open is a seed, with no storm yet", () => {
  const selection = withCell(null, cell("C1"));
  assert.equal(selection.id, null);
  assert.equal(selection.cell?.code, "C1");
  assert.equal(selectionKey(selection), "cell:C1");
  assert.deepEqual(lookupOf(selection), { cell: "C1" });
});

test("walking to a cell the open storm claims stays in that storm", () => {
  const open = fromStorm(claimed(A, "C2"));
  const walked = withCell(open, cell("C2"));
  assert.equal(walked.id, A);
  assert.equal(walked.cell?.code, "C2");
  assert.equal(walked.summary, open.summary);
});

test("walking to a cell the open storm does not claim starts over from that cell", () => {
  const walked = withCell(fromStorm(claimed(A, "C2")), cell("C9"));
  assert.equal(walked.id, null);
  assert.equal(walked.summary, null);
  assert.equal(walked.cell?.code, "C9");
});

test("a cell handed over again keeps the volume an earlier copy had", () => {
  const known = cell("C1", { volume: { path: "v1", coverage: 1 } });
  const again = withCell(withCell(null, known), cell("C1", { volume: null }));
  assert.equal(again.cell?.volume?.path, "v1");
});

test("a box of sky with no storm open is a seed, looked up by the patch it names", () => {
  const selection = withVolume(null, volume("p/1", { feature: "patch-7" }));
  assert.equal(selection.id, null);
  assert.equal(selectionKey(selection), "cloud:p/1");
  assert.deepEqual(lookupOf(selection), { feature: "patch-7" });
});

test("a box with no patch named cannot be looked up", () => {
  assert.equal(lookupOf(withVolume(null, volume("p/1"))), null);
});

test("a box of the open storm's own patch stays in that storm", () => {
  const open = withDetail(fromStorm(storm(A)), detail(storm(A), {
    tracks: [trackerTrack("t1", [feature("core-1", 0, { parent: "patch-7" })])],
  }))!;
  const tapped = withVolume(open, volume("p/1", { feature: "patch-7" }));
  assert.equal(tapped.id, A);
  assert.equal(tapped.volume?.path, "p/1");
});

test("finding a seed's storm keeps what the seed was opened on", () => {
  const seed = withCell(null, cell("C1"));
  const found = withStorm(seed, claimed(A, "C1"));
  assert.equal(found.id, A);
  assert.equal(found.cell?.code, "C1");
  assert.equal(isResolution(seed, found), true);
});

test("a refresh of the open storm keeps its detail and cell", () => {
  const open = withDetail(fromStorm(claimed(A, "C1")), detail(claimed(A, "C1"), {
    konrad3d: [trackFeature(cell("C1"))],
  }))!;
  const refreshed = withStorm(open, claimed(A, "C1"));
  assert.equal(refreshed.detail, open.detail);
  assert.equal(refreshed.cell?.code, "C1");
});

test("another storm replaces the selection outright", () => {
  const open = withDetail(fromStorm(storm(A)), detail(storm(A)))!;
  const other = withStorm(open, storm(B));
  assert.equal(other.id, B);
  assert.equal(other.detail, null);
  assert.equal(isResolution(open, other), false);
});

test("opening another seed is not a resolution of the first", () => {
  assert.equal(isResolution(withCell(null, cell("C1")), withStorm(withCell(null, cell("C2")), storm(A))), false);
});

test("a detail shows the storm's primary KONRAD3D track", () => {
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C2" });
  const selection = withDetail(fromStorm(of), detail(of, {
    konrad3d: [trackFeature(cell("C1", { last_seen: at(5) })), trackFeature(cell("C2"))],
  }))!;
  assert.equal(selection.cell?.code, "C2");
});

test("with the tracker primary, the most recently seen KONRAD3D track is shown", () => {
  const of = storm(A, { primary_product: "meteocool/tracker", primary_track: "t1" });
  const shown = primaryCell(detail(of, {
    konrad3d: [trackFeature(cell("C1", { last_seen: at(-10) })), trackFeature(cell("C2", { last_seen: at(-2) }))],
  }));
  assert.equal(shown?.code, "C2");
});

test("a storm KONRAD3D does not track has no cell", () => {
  const of = storm(A, { primary_product: "meteocool/tracker", primary_domain: "fr" });
  assert.equal(withDetail(fromStorm(of), detail(of))!.cell, null);
});

test("a detail keeps the cell walked to rather than going back to the primary one", () => {
  const of = storm(A, { primary_product: "dwd/konrad3d", primary_track: "C2", tracks: [
    { product: "dwd/konrad3d", domain: "de", track: "C1" },
    { product: "dwd/konrad3d", domain: "de", track: "C2" },
  ] });
  const walked = withCell(fromStorm(of), cell("C1"));
  const fetched = withDetail(walked, detail(of, {
    konrad3d: [trackFeature(cell("C1", { max_severity: 3 })), trackFeature(cell("C2"))],
  }))!;
  assert.equal(fetched.cell?.code, "C1");
  assert.equal(fetched.cell?.max_severity, 3);
});

test("a detail for a storm no longer selected changes nothing", () => {
  const open = fromStorm(storm(B));
  assert.equal(withDetail(open, detail(storm(A))), open);
  assert.equal(withDetail(null, detail(storm(A))), null);
});

test("a storm claims a cell by its tracks, its detail's tracks, or its detail's cells", () => {
  assert.equal(claimsCell(fromStorm(claimed(A, "C1")), "C1"), true);
  const byDetailTracks = { ...byId(A), detail: detail(claimed(A, "C2")) };
  assert.equal(claimsCell(byDetailTracks, "C2"), true);
  const viaDetail = { ...fromStorm(storm(A)), detail: detail(storm(A), { konrad3d: [trackFeature(cell("C3"))] }) };
  assert.equal(claimsCell(viaDetail, "C3"), true);
  assert.equal(claimsCell(viaDetail, "C4"), false);
});

test("a volume's patch is the storm's when one of its cores sits in it", () => {
  const selection = { ...fromStorm(storm(A)), detail: detail(storm(A), {
    tracks: [trackerTrack("t1", [feature("core-1", 0, { parent: "patch-7" })])],
  }) };
  assert.equal(holdsFeature(selection, "patch-7"), true);
  assert.equal(holdsFeature(selection, "core-1"), true);
  assert.equal(holdsFeature(selection, "patch-8"), false);
});

test("only DWD's class is named as a severity", () => {
  assert.equal(knowsSeverity(fromStorm(storm(A, { primary_product: "dwd/konrad3d" }))), true);
  assert.equal(knowsSeverity(fromStorm(storm(A, { primary_product: "meteocool/tracker" }))), false);
  assert.equal(knowsSeverity(withCell(null, cell("C1"))), true);
});

test("where a storm is: its centroid, else its cell, else its box", () => {
  assert.deepEqual(positionOf(fromStorm(storm(A, {}, [[9, 49], [9.5, 49.5]]))), [9.5, 49.5]);
  assert.deepEqual(positionOf(withCell(null, cell("C1"))), [10.1, 50.05]);
  assert.deepEqual(positionOf(withVolume(null, volume("p", { lon: 7, lat: 47 }))), [7, 47]);
});

test("the slice starts along the cell's heading, else the storm's, else north", () => {
  assert.equal(headingOf(withCell(null, cell("C1"))), 90);
  assert.equal(headingOf(fromStorm(storm(A, { heading_deg: 45 }))), 45);
  assert.equal(headingOf(withVolume(null, volume("p"))), null);
});

test("the storm's box is the one cut from its newest patch nearest its centroid", () => {
  const of = storm(A, {}, [[10, 50], [10.1, 50.05]]);
  const selection = withDetail(fromStorm(of), detail(of, {
    tracks: [trackerTrack("t1", [
      feature("old", -5, { parent: "patch-old" }),
      feature("now", 0, { parent: "patch-now" }),
    ])],
  }))!;
  assert.deepEqual(newestPatches(selection), ["patch-now"]);
  const chosen = volumeOfStorm([
    volume("far", { feature: "patch-now", lon: 10.4, lat: 50.2 }),
    volume("near", { feature: "patch-now", lon: 10.11, lat: 50.06 }),
    volume("stale", { feature: "patch-old", lon: 10.1, lat: 50.05 }),
    volume("coarse", { feature: "patch-now", coarse: true, lon: 10.1, lat: 50.05 }),
  ], selection);
  assert.equal(chosen?.path, "near");
});

test("volumes that name no patch give a storm no box", () => {
  const of = storm(A);
  const selection = withDetail(fromStorm(of), detail(of, { tracks: [trackerTrack("t1", [feature("c", 0, { parent: "p" })])] }))!;
  assert.equal(volumeOfStorm([volume("v")], selection), null);
});

test("a tracker history is the primary track's features, one per frame, oldest first", () => {
  const of = storm(A, { primary_product: "meteocool/tracker", primary_track: "t1" });
  const series = trackerSeries(detail(of, {
    tracks: [
      trackerTrack("t0", [feature("x", -10, { peak_dbz: 70 })]),
      trackerTrack("t1", [
        feature("b", -5, { peak_dbz: 52, area_km2: 30 }),
        feature("a", -10, { peak_dbz: 48, area_km2: 20 }),
        feature("b2", -5, { peak_dbz: 45, area_km2: 5 }),
      ]),
    ],
  }));
  assert.deepEqual(series, [
    { t: at(-10), peak_dbz: 48, area_km2: 20 },
    { t: at(-5), peak_dbz: 52, area_km2: 30 },
  ]);
});

test("a cell is found in its storm by the tracks each listed storm claims", () => {
  assert.equal(stormClaiming([storm(A), claimed(B, "C1")], "C1")?.properties.id, B);
  assert.equal(stormClaiming([storm(A)], "C1"), null);
});

test("the storms worth searching for a box are the few nearest it", () => {
  const near = storm(A, {}, [[10.1, 50.05]]);
  const further = storm(B, {}, [[10.3, 50.05]]);
  const far = storm(sid("C"), {}, [[12, 52]]);
  const found = nearestStorms([far, further, near, near], [10.1, 50.05], 40, 2);
  assert.deepEqual(found.map((s) => s.properties.id), [A, B]);
});

test("a storm named by id alone takes the map's copy when there is one", () => {
  assert.equal(byId(A, [storm(A)]).summary?.properties.id, A);
  assert.equal(byId(A, []).summary, null);
  assert.equal(byId(A, []).id, A);
});

test("the storms that merged into one are found among those held", () => {
  const merged = storm(B, { status: "merged", merged_into: A });
  assert.deepEqual(mergedInto([storm(A), merged], A).map((s) => s.properties.id), [B]);
});

test("the outline is the KONRAD3D cell's where that track is primary, else the tracker's newest", () => {
  const ring = [[1, 1], [2, 1], [2, 2], [1, 1]];
  const konrad = withDetail(fromStorm(storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1" })),
    detail(storm(A, { primary_product: "dwd/konrad3d", primary_track: "C1" }), {
      konrad3d: [trackFeature(cell("C1", { polygon: ring }))],
    }))!;
  assert.deepEqual(outlineOf(konrad), ring);
  const ours = storm(A, { primary_product: "meteocool/tracker", primary_track: "t1" });
  const tracker = withDetail(fromStorm(ours), detail(ours, { tracks: [trackerTrack("t1", [feature("c", 0)])] }))!;
  assert.equal(outlineOf(tracker)?.length, 4);
  assert.equal(outlineOf(fromStorm(storm(A))), null);
});
