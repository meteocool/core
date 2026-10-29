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
 * holding down are the ones about bad input (a value that does not parse is
 * dropped, never half-applied) and about round trips: whatever the app
 * writes, it has to read back as the same state, or a reload lands somewhere
 * other than where the reader was.
 */

const PATH = "meteoradar/volumes/20260924T194500/R39853139.mcvx";
const CELL = "2026092421259838083011";

test("a storm core's volume path shortens to scan/code and back", () => {
  assert.equal(cloudLink(PATH), "20260924T194500/R39853139");
  assert.equal(cloudPath("20260924T194500/R39853139"), PATH);
});

test("a network's storm core, named the way the worker files it now, round-trips too", () => {
  // `volumes/{scan}/{network}-{code}.mcvx`, the code a position: every
  // volume since five networks were boxed. The link took only the old
  // `R...` names, so an opened core was never written into the address.
  const path = "meteoradar/volumes/20261001T142500/de-G1401218632.mcvx";
  assert.equal(cloudLink(path), "20261001T142500/de-G1401218632");
  assert.equal(cloudPath("20261001T142500/de-G1401218632"), path);
  assert.equal(cloudPath(cloudLink("meteoradar/volumes/20261001T071100/pl-G1411619766.mcvx")!),
    "meteoradar/volumes/20261001T071100/pl-G1411619766.mcvx");
});

test("a tile of a storm, named the way the worker files it since tiles, round-trips", () => {
  // `T`, the zoom in two digits, x and y in five: the worker's `Tile.code`.
  const path = "meteoradar/volumes/20261005T142500/fr-T100054200360.mcvx";
  assert.equal(cloudLink(path), "20261005T142500/fr-T100054200360");
  assert.equal(cloudPath("20261005T142500/fr-T100054200360"), path);
  assert.equal(cloudPath("20261005T142500/fr-T1000542003600"), null);
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
    overlays: { cells: true, lightning: false, mesocyclones: true },
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
  assert.deepEqual(parseLink("?overlays=lightning,cells").overlays, { cells: true, lightning: true, mesocyclones: false });
  assert.deepEqual(parseLink("?overlays=none").overlays, { cells: false, lightning: false, mesocyclones: false });
  // Naming nothing the app has is not the same as turning everything off.
  assert.equal(parseLink("?overlays=lightnin").overlays, undefined);
  assert.equal(linkSearch("", { overlays: { cells: false, lightning: false, mesocyclones: false } }),
    "?overlays=-cells,-lightning,-mesocyclones");
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
  assert.equal(isNavigation(here, { ...here, overlays: { cells: false } }), false);
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

/* ---- storms -------------------------------------------------------------- */

const STORM = "01JA4Z9Q2B7XKMN3PDRSTVWXYZ";

test("a storm round-trips through the query string, panel and slice included", () => {
  const state: LinkState = { layer: "radar", storm: STORM, details: false, cut: 30 };
  const search = linkSearch("", state);
  assert.equal(search, `?layer=radar&storm=${STORM}&details=0&cut=30`);
  assert.deepEqual(parseLink(search), state);
});

test("a storm wins over a cell and a cloud, and over a frame off the live edge", () => {
  const state = parseLink(`?storm=${STORM}&cell=${CELL}&cloud=20260924T194500/R39853139&t=20260924T1945Z`);
  assert.equal(state.storm, STORM);
  assert.equal(state.cell, undefined);
  assert.equal(state.cloud, undefined);
  assert.equal(state.time, undefined);
});

test("a storm written beside its seed is the only one written", () => {
  assert.equal(linkSearch("", { storm: STORM, cell: CELL, cloud: PATH }), `?storm=${STORM}`);
});

test("a malformed storm id is dropped; the cell it came with is kept", () => {
  assert.equal(parseLink("?storm=not-a-storm").storm, undefined);
  assert.equal(parseLink(`?storm=${STORM.toLowerCase()}`).storm, undefined);
  assert.equal(parseLink(`?storm=${STORM.replace("Z", "U")}`).storm, undefined);
  assert.equal(parseLink(`?storm=bad&cell=${CELL}`).cell, CELL);
});

test("the old cell and cloud links still parse, to be found in their storms", () => {
  assert.equal(parseLink(`?cell=${CELL}`).cell, CELL);
  assert.equal(parseLink("?cloud=20260924T194500/R39853139").cloud, PATH);
});

test("opening, changing or closing a storm is navigation", () => {
  const here: LinkState = { layer: "radar" };
  assert.equal(isNavigation(here, { ...here, storm: STORM }), true);
  assert.equal(isNavigation({ ...here, storm: STORM }, here), true);
  assert.equal(isNavigation({ ...here, storm: STORM }, { ...here, storm: STORM, details: false }), false);
});

test("a radar open round-trips, reflectivity and the default left unsaid", () => {
  const state: LinkState = { layer: "radar", radar: { site: "frave", quantity: "srv", tilt: 0.39 } };
  const search = linkSearch("", state);
  assert.equal(search, "?layer=radar&radar=frave&sweep=srv&tilt=0.39");
  assert.deepEqual(parseLink(search), state);
  assert.equal(linkSearch("", { radar: { site: "deoft", quantity: "reflectivity", tilt: 0.5 } }), "?radar=deoft&tilt=0.5");
  assert.deepEqual(parseLink("?radar=DEOFT").radar, { site: "deoft", quantity: "reflectivity" });
});

test("a radar link that does not parse is dropped, and an unknown sweep is reflectivity", () => {
  assert.equal(parseLink("?radar=../tiles").radar, undefined);
  assert.equal(parseLink("?radar=").radar, undefined);
  assert.deepEqual(parseLink("?radar=deoft&sweep=hail&tilt=-3").radar, { site: "deoft", quantity: "reflectivity" });
  // A tilt or sweep alone means nothing.
  assert.equal(parseLink("?sweep=velocity&tilt=1.5").radar, undefined);
});

test("opening, switching or closing a radar is a step Back undoes; turning its tilt is not", () => {
  const at = (site?: string, tilt = 0.5): LinkState => ({
    layer: "radar", ...(site ? { radar: { site, quantity: "reflectivity" as const, tilt } } : {}),
  });
  assert.equal(isNavigation(at(), at("deoft")), true);
  assert.equal(isNavigation(at("deoft"), at("frave")), true);
  assert.equal(isNavigation(at("deoft"), at()), true);
  assert.equal(isNavigation(at("deoft"), at("deoft", 1.5)), false);
});

/* ---- what the map shows: overlays, product, marks, stations ------------- */

/** Every overlay of the radar map, as a link from it names them. */
const RADAR_OVERLAYS = { cells: true, lightning: true, mesocyclones: true, sites: true, stations: false } as const;

test("a link made now names every overlay of its map, the ones off with a minus", () => {
  const search = linkSearch("", { layer: "radar", overlays: RADAR_OVERLAYS });
  assert.equal(search, "?layer=radar&overlays=cells,lightning,mesocyclones,sites,-stations");
  assert.deepEqual(parseLink(search).overlays, RADAR_OVERLAYS);
});

test("an overlay a link made now names as off is off, not the receiver's own", () => {
  const { overlays } = parseLink("?overlays=cells,lightning,mesocyclones,sites,-stations");
  assert.equal(overlays?.stations, false);
});

test("an old link's list keeps its meaning: the first three it names on, the rest of those three off", () => {
  assert.deepEqual(parseLink("?overlays=cells,mesocyclones").overlays, { cells: true, lightning: false, mesocyclones: true });
});

test("an old link leaves the overlays added since to the receiver", () => {
  const { overlays } = parseLink("?overlays=cells,lightning");
  assert.equal("stations" in overlays!, false);
  assert.equal("sites" in overlays!, false);
  assert.equal("tiers" in overlays!, false);
  assert.equal("stations" in parseLink("?overlays=none").overlays!, false);
});

test("a link without overlays leaves every one to the receiver", () => {
  assert.equal(parseLink("?layer=radar&latLonZ=48,11,8").overlays, undefined);
});

test("a list that names a newer overlay leaves any overlay it does not name to the receiver", () => {
  // The 3D map's own: the radar map's are not its business.
  assert.deepEqual(parseLink("?layer=cells3d&overlays=-tiers").overlays, { tiers: false });
  assert.deepEqual(parseLink("?overlays=stations").overlays, { stations: true });
});

test("names the app does not have are ignored, and a list of nothing else is dropped", () => {
  assert.deepEqual(parseLink("?overlays=-stationz,sites").overlays, { sites: true });
  assert.equal(parseLink("?overlays=-fronts").overlays, undefined);
  assert.equal(parseLink("?overlays=-").overlays, undefined);
});

test("the radar product round-trips, and one the app does not have is dropped", () => {
  assert.equal(linkSearch("", { layer: "radar", product: "colmax" }), "?layer=radar&product=colmax");
  assert.equal(parseLink("?product=colmax").product, "colmax");
  assert.equal(parseLink("?product=hx").product, "hx");
  assert.equal(parseLink("?product=rainbow").product, undefined);
});

test("the storm marks put away round-trip in the key's order, and nothing put away is none", () => {
  const search = linkSearch("", { hide: ["path", "weak"] });
  assert.equal(search, "?hide=weak,path");
  assert.deepEqual(parseLink(search).hide, ["weak", "path"]);
  assert.equal(linkSearch("", { hide: [] }), "?hide=none");
  assert.deepEqual(parseLink("?hide=none").hide, []);
});

test("a list of storm marks naming none the key has is dropped, and unknown ones in it are ignored", () => {
  assert.equal(parseLink("?hide=tornado").hide, undefined);
  assert.deepEqual(parseLink("?hide=tornado,hail").hide, ["hail"]);
});

test("the stations' parameter round-trips with the stations on", () => {
  const state: LinkState = { layer: "radar", overlays: { ...RADAR_OVERLAYS, stations: true }, stationParameter: "temperature" };
  const search = linkSearch("", state);
  assert.equal(search, "?layer=radar&overlays=cells,lightning,mesocyclones,sites,stations&stationParameter=temperature");
  assert.deepEqual(parseLink(search), state);
});

test("the stations' parameter is neither written nor read with the stations off or unnamed", () => {
  assert.equal(linkSearch("", { overlays: RADAR_OVERLAYS, stationParameter: "temperature" }),
    "?overlays=cells,lightning,mesocyclones,sites,-stations");
  assert.equal(parseLink("?overlays=-stations&stationParameter=temperature").stationParameter, undefined);
  assert.equal(parseLink("?stationParameter=temperature").stationParameter, undefined);
});

test("a stations' parameter the stations do not have is dropped", () => {
  assert.equal(parseLink("?overlays=stations&stationParameter=snow").stationParameter, undefined);
});

test("a station's sheet round-trips, and brings the stations' parameter with it", () => {
  const state: LinkState = { layer: "radar", stationParameter: "pressure", station: "02290" };
  const search = linkSearch("", state);
  assert.equal(search, "?layer=radar&stationParameter=pressure&station=02290");
  assert.deepEqual(parseLink(search), state);
});

test("a station's id has to be safe as a path segment", () => {
  assert.equal(parseLink("?station=../../admin").station, undefined);
  assert.equal(parseLink("?station=a%2Fb").station, undefined);
  assert.equal(parseLink("?station=").station, undefined);
});

test("a storm beside a station's sheet or the model comparison is the one opened", () => {
  const state = parseLink(`?storm=${STORM}&station=02290&compare=48.1,11.5`);
  assert.equal(state.storm, STORM);
  assert.equal(state.station, undefined);
  assert.equal(state.compare, undefined);
  assert.equal(linkSearch("", { cell: CELL, station: "02290", compare: [48.1, 11.5] }), `?cell=${CELL}`);
});

test("the model comparison's point round-trips, and one out of range is dropped", () => {
  const search = linkSearch("", { layer: "radar", compare: [48.13715, 11.57612] });
  assert.equal(search, "?layer=radar&compare=48.13715,11.57612");
  assert.deepEqual(parseLink(search).compare, [48.13715, 11.57612]);
  assert.equal(parseLink("?compare=95,11").compare, undefined);
  assert.equal(parseLink("?compare=48").compare, undefined);
});

test("a hand's storm motion round-trips with SRV drawn, as the dial holds it", () => {
  const state: LinkState = { layer: "radar", radar: { site: "deoft", quantity: "srv" }, motion: { headingDeg: 225, speedKmh: 40 } };
  const search = linkSearch("", state);
  assert.equal(search, "?layer=radar&radar=deoft&sweep=srv&motion=225,40");
  assert.deepEqual(parseLink(search), state);
  // Snapped to the dial's five degrees and whole km/h.
  assert.deepEqual(parseLink("?radar=deoft&sweep=srv&motion=223,40.4").motion, { headingDeg: 225, speedKmh: 40 });
});

test("a storm motion without SRV drawn, or one that does not parse, is dropped", () => {
  assert.equal(parseLink("?radar=deoft&sweep=velocity&motion=225,40").motion, undefined);
  assert.equal(parseLink("?motion=225,40").motion, undefined);
  assert.equal(parseLink("?radar=deoft&sweep=srv&motion=225").motion, undefined);
  assert.equal(parseLink("?radar=deoft&sweep=srv&motion=225,-5").motion, undefined);
  assert.equal(linkSearch("", { radar: { site: "deoft", quantity: "velocity" }, motion: { headingDeg: 0, speedKmh: 30 } }),
    "?radar=deoft&sweep=velocity");
});

test("the 3D map's peel round-trips in hundredths, held between none and all", () => {
  const search = linkSearch("", { layer: "cells3d", overlays: { tiers: false }, peel: 0.456 });
  assert.equal(search, "?layer=cells3d&overlays=-tiers&peel=0.46");
  assert.equal(parseLink(search).peel, 0.46);
  assert.equal(parseLink("?peel=4").peel, 1);
  assert.equal(parseLink("?peel=-1").peel, 0);
  assert.equal(parseLink("?peel=deep").peel, undefined);
});

test("the peel means nothing beside an open storm", () => {
  assert.equal(parseLink(`?cloud=20260924T194500/R39853139&peel=0.5`).peel, undefined);
  assert.equal(linkSearch("", { cloud: PATH, peel: 0.5 }), "?cloud=20260924T194500/R39853139");
});

test("on the 3D map an earlier scan round-trips as the frame does", () => {
  const scan = Date.UTC(2026, 9, 25, 14, 5) / 1000;
  const search = linkSearch("", { layer: "cells3d", overlays: { tiers: true }, time: scan });
  assert.equal(search, "?layer=cells3d&overlays=tiers&t=20261025T1405Z");
  assert.equal(parseLink(search).time, scan);
});

test("opening, changing or closing a station's sheet or the model comparison is navigation", () => {
  const here: LinkState = { layer: "radar" };
  assert.equal(isNavigation(here, { ...here, station: "02290" }), true);
  assert.equal(isNavigation({ ...here, station: "02290" }, { ...here, station: "10865" }), true);
  assert.equal(isNavigation({ ...here, station: "02290" }, here), true);
  assert.equal(isNavigation(here, { ...here, compare: [48.1, 11.5] }), true);
  assert.equal(isNavigation({ ...here, compare: [48.1, 11.5] }, here), true);
});

test("changing what the map shows is not navigation", () => {
  const here: LinkState = { layer: "radar", overlays: RADAR_OVERLAYS, product: "hx", hide: [] };
  assert.equal(isNavigation(here, { ...here, overlays: { ...RADAR_OVERLAYS, stations: true }, stationParameter: "temperature" }), false);
  assert.equal(isNavigation(here, { ...here, product: "merged" }), false);
  assert.equal(isNavigation(here, { ...here, hide: ["weak"] }), false);
});

test("a whole radar link round-trips", () => {
  const state: LinkState = {
    layer: "radar",
    view: { lat: 50.5, lon: 10, zoom: 8 },
    overlays: { cells: true, lightning: false, mesocyclones: true, sites: true, stations: true },
    product: "merged",
    hide: ["weak", "forecast"],
    stationParameter: "gusts",
    time: Date.UTC(2026, 9, 25, 14, 5) / 1000,
    point: [50.1, 9.9],
    radar: { site: "deoft", quantity: "srv", tilt: 0.5 },
    motion: { headingDeg: 60, speedKmh: 35 },
    station: "02290",
    compare: [50.1, 9.9],
  };
  assert.deepEqual(parseLink(linkSearch("", state)), state);
});

test("old links read exactly as they did, with none of the new choices in them", () => {
  const old = `?layer=radar&latLonZ=48.13715,11.57612,8.00&overlays=cells,mesocyclones&t=20260924T1945Z&point=48.2,11.6&radar=deoft&sweep=srv&tilt=0.5`;
  assert.deepEqual(parseLink(old), {
    layer: "radar",
    view: { lat: 48.13715, lon: 11.57612, zoom: 8 },
    overlays: { cells: true, lightning: false, mesocyclones: true },
    time: Date.UTC(2026, 8, 24, 19, 45) / 1000,
    point: [48.2, 11.6],
    radar: { site: "deoft", quantity: "srv", tilt: 0.5 },
  });
  assert.deepEqual(parseLink(`?layer=cells3d&cloud=20260924T194500/R39853139&cut=30&pitch=55&bearing=-30`), {
    layer: "cells3d", pitch: 55, bearing: -30, cloud: PATH, cut: 30,
  });
});
