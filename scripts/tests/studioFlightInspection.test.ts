import assert from "node:assert/strict";
import { test } from "node:test";
import { readFlightLink, flightLinkQuery } from "../../src/lib/studio/flightLink.ts";
import { CUT_PUSH_KM } from "../../src/lib/studio/flight/cut.ts";
import { destination } from "../../src/lib/studio/flight/geo.ts";
import { INSPECTION_KEY, markFor, readInspection } from "../../src/lib/studio/flight/inspection.ts";
import { MARK_APART_KM } from "../../src/lib/studio/flight/marks.ts";

const cutOpen = { lon: 10.31, lat: 46.42, mode: "cut", cut: { facingDeg: 237.5, pushKm: 4 }, peel: 0.6 };

test("a storm cut open in a shared flight comes back from its link with the cut where it stood", () => {
  const start = { lat: 46.3, lon: 10.2, heading: 45, altitude: 4000, speed: null, view: "outside" as const, snapshot: { v: 1, [INSPECTION_KEY]: cutOpen } };
  const snapshot = readFlightLink(`?${flightLinkQuery(start)}`)?.snapshot;
  assert.ok(snapshot);
  assert.deepEqual(readInspection(snapshot), cutOpen);
});

test("a storm peeled or seen through keeps its peel and has no cut", () => {
  assert.deepEqual(readInspection({ inspect: { ...cutOpen, mode: "peel", peel: 0.35 } }), { ...cutOpen, mode: "peel", cut: null, peel: 0.35 });
  assert.deepEqual(readInspection({ inspect: { ...cutOpen, mode: "xray" } }), { ...cutOpen, mode: "xray", cut: null });
});

test("a flight shared with no storm looked into has none to look into", () => {
  assert.equal(readInspection({ v: 1 }), null);
  assert.equal(readInspection({ inspect: null }), null);
});

test("an inspection a link gets wrong is none, and a cut or peel out of reach is held to it", () => {
  assert.equal(readInspection({ inspect: { ...cutOpen, mode: "melt" } }), null);
  assert.equal(readInspection({ inspect: { ...cutOpen, lat: 123 } }), null);
  assert.equal(readInspection({ inspect: [cutOpen] }), null);
  const odd = readInspection({ inspect: { ...cutOpen, cut: { facingDeg: -30, pushKm: 99 }, peel: 7 } });
  assert.deepEqual([odd?.cut, odd?.peel], [{ facingDeg: 330, pushKm: CUT_PUSH_KM }, 1]);
  // A cut with no facing is set afresh, facing the aircraft; no peel said is the flight's own.
  const loose = readInspection({ inspect: { ...cutOpen, cut: { pushKm: 2 }, peel: "lots" } });
  assert.deepEqual([loose?.mode, loose?.cut, loose?.peel], ["cut", null, null]);
});

test("the storm looked into is the marked one nearest where it was, moved on but not another's", () => {
  const [lon, lat] = [cutOpen.lon, cutOpen.lat];
  const along = (km: number) => {
    const [markLon, markLat] = destination(lon, lat, 80, km * 1000);
    return { lon: markLon, lat: markLat, name: `${km} km on` };
  };
  const [moved, further, elsewhere] = [along(6), along(15), along(MARK_APART_KM + 1)];
  assert.equal(markFor([elsewhere, further, moved], cutOpen), moved);
  assert.equal(markFor([elsewhere], cutOpen), null);
  assert.equal(markFor([], cutOpen), null);
});
