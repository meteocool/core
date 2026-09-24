import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudLink, cloudPath, frameLink, frameTime, isNavigation, linkSearch, parseLink,
} from "../../src/lib/deepLink.ts";
import type { LinkState } from "../../src/lib/deepLink.ts";

/**
 * What a link to the map carries, and what it refuses to.
 *
 * A link is text anyone can edit and anyone can be sent, so the rules worth
 * holding down are the ones about bad input -- a value that does not parse is
 * dropped, never half-applied -- and about round trips: whatever the app
 * writes, it has to read back as the same state, or a reload lands somewhere
 * other than where the reader was.
 */

const PATH = "meteoradar/volumes/20260924T194500/R39853139.mcvx";
const CELL = "2026092421259838083011";

test("a storm core's volume path shortens to scan/code and back", () => {
  assert.equal(cloudLink(PATH), "20260924T194500/R39853139");
  assert.equal(cloudPath("20260924T194500/R39853139"), PATH);
});

test("a cloud link can only ever name a volume", () => {
  // Rebuilt from two validated pieces, so there is no way to point the client
  // at another object on the tile host.
  assert.equal(cloudPath("../../etc/passwd"), null);
  assert.equal(cloudPath("20260924T194500/R39853139/../../x"), null);
  assert.equal(cloudPath("20260924T194500/2026092421259838083011"), null);
  assert.equal(cloudLink("meteoradar/volumes/elsewhere/R1.mcvx"), null);
});

test("frame times read as UTC minutes and survive the round trip", () => {
  const t = Date.UTC(2026, 8, 24, 19, 45) / 1000;
  assert.equal(frameLink(t), "20260924T1945Z");
  assert.equal(frameTime("20260924T1945Z"), t);
});

test("a frame time that is not a real minute is refused", () => {
  // Date.UTC would roll these over into a valid, different time.
  assert.equal(frameTime("20260231T1200Z"), null);
  assert.equal(frameTime("20260924T2560Z"), null);
  assert.equal(frameTime("2026-09-24T19:45Z"), null);
});

test("the old latLonZ links still open where they did", () => {
  // Six decimals and a zoom with two, the shape the app wrote for years.
  const state = parseLink("?latLonZ=48.137154,11.576124,8.00");
  assert.deepEqual(state.view, { lat: 48.137154, lon: 11.576124, zoom: 8 });
});

test("a view out of range, or not three numbers, is dropped", () => {
  assert.equal(parseLink("?latLonZ=91,11,8").view, undefined);
  assert.equal(parseLink("?latLonZ=48,181,8").view, undefined);
  assert.equal(parseLink("?latLonZ=48,11").view, undefined);
  assert.equal(parseLink("?latLonZ=48,11,eight").view, undefined);
  assert.equal(parseLink("?latLonZ=,,").view, undefined);
});

test("a whole 3D state round-trips through the query string", () => {
  const state: LinkState = {
    layer: "cells3d",
    view: { lat: 47.59412, lon: 12.98929, zoom: 9.5 },
    pitch: 55,
    bearing: -30,
    cloud: PATH,
    cut: 45,
  };
  const search = linkSearch("", state);
  assert.equal(
    search,
    "?layer=cells3d&latLonZ=47.59412,12.98929,9.50&pitch=55&bearing=-30&cloud=20260924T194500/R39853139&cut=45",
  );
  assert.deepEqual(parseLink(search), state);
});

test("a radar state with a cell, overlays and a point round-trips", () => {
  const state: LinkState = {
    layer: "radar",
    view: { lat: 48.1, lon: 11.5, zoom: 8 },
    overlays: ["cells", "mesocyclones"],
    cell: CELL,
    details: false,
    point: [48.2, 11.6],
  };
  assert.deepEqual(parseLink(linkSearch("", state)), state);
});

test("parameters the link does not own are kept, in their own order", () => {
  const search = linkSearch("?toolbar=no&logo=none&cell=old", { layer: "radar" });
  assert.equal(search, "?toolbar=no&logo=none&layer=radar");
});

test("the same state always writes the same string", () => {
  // Whatever order the parameters arrived in: that is what lets the writer
  // tell "nothing changed" from a string compare.
  const a = linkSearch("?cut=10&layer=cells3d", parseLink("?cut=10&layer=cells3d"));
  const b = linkSearch("?layer=cells3d&cut=10", parseLink("?layer=cells3d&cut=10"));
  assert.equal(a, b);
});

test("kept parameters are carried over verbatim rather than rewritten", () => {
  const search = linkSearch("?latLonZ=48.137154,11.576124,8.00", { layer: "radar" }, ["latLonZ"]);
  assert.equal(search, "?layer=radar&latLonZ=48.137154,11.576124,8.00");
});

test("a cell wins over a cloud, and over a frame off the live edge", () => {
  const state = parseLink(`?cell=${CELL}&cloud=20260924T194500/R39853139&t=20260924T1945Z`);
  assert.equal(state.cell, CELL);
  assert.equal(state.cloud, undefined);
  // Cells are only drawn on the newest frame, so a link cannot mean both.
  assert.equal(state.time, undefined);
});

test("the panel flag and the slice mean nothing without a selection", () => {
  const state = parseLink("?details=0&cut=40");
  assert.equal(state.details, undefined);
  assert.equal(state.cut, undefined);
});

test("an open panel is the default and is never written", () => {
  assert.equal(linkSearch("", { cell: CELL, details: true }), `?cell=${CELL}`);
  assert.equal(parseLink(`?cell=${CELL}&details=1`).details, undefined);
});

test("an uncut slice is not written", () => {
  assert.equal(linkSearch("", { cloud: PATH, cut: 0 }), "?cloud=20260924T194500/R39853139");
  assert.equal(linkSearch("", { cloud: PATH, cut: 360 }), "?cloud=20260924T194500/R39853139");
});

test("angles are folded, so one direction has one spelling", () => {
  assert.equal(parseLink(`?cell=${CELL}&cut=370`).cut, 10);
  assert.equal(parseLink("?bearing=270").bearing, -90);
  assert.equal(parseLink("?bearing=-180").bearing, -180);
  assert.equal(parseLink("?pitch=120").pitch, 85);
});

test("overlays: a list, none, and a typo", () => {
  assert.deepEqual(parseLink("?overlays=lightning,cells").overlays, ["cells", "lightning"]);
  assert.deepEqual(parseLink("?overlays=none").overlays, []);
  // Naming nothing the app has is not the same as turning everything off.
  assert.equal(parseLink("?overlays=lightnin").overlays, undefined);
  assert.equal(linkSearch("", { overlays: [] }), "?overlays=none");
});

test("a track code has to be safe as a path segment", () => {
  assert.equal(parseLink("?cell=../../admin").cell, undefined);
  assert.equal(parseLink("?cell=a%2Fb").cell, undefined);
});

test("a layer name is a plain word; whether it exists is not decided here", () => {
  assert.equal(parseLink("?layer=cells3d").layer, "cells3d");
  assert.equal(parseLink("?layer=<script>").layer, undefined);
});

test("switching map or storm is navigation; adjusting the view is not", () => {
  const here: LinkState = { layer: "radar", view: { lat: 48, lon: 11, zoom: 8 } };
  assert.equal(isNavigation(here, { ...here, view: { lat: 49, lon: 11, zoom: 9 } }), false);
  assert.equal(isNavigation(here, { ...here, overlays: [] }), false);
  assert.equal(isNavigation(here, { ...here, layer: "cells3d" }), true);
  assert.equal(isNavigation(here, { ...here, cell: CELL }), true);
  assert.equal(isNavigation({ ...here, cell: CELL }, here), true);
  assert.equal(isNavigation({ ...here, cell: CELL }, { ...here, cell: CELL, cut: 30 }), false);
});

test("a link that names no layer is not a different layer", () => {
  // The first state written over a bare URL, or an old latLonZ-only link, is
  // not something the Back button should step back from.
  assert.equal(isNavigation({}, { layer: "radar" }), false);
});
