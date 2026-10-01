import assert from "node:assert/strict";
import test from "node:test";
import { contributions, radarSite } from "../../src/lib/radarSites.ts";

test("a radar is found by its node code, whichever network it reports through", () => {
  assert.equal(radarSite("deisn")?.name, "Isen");
  assert.equal(radarSite("frnan")?.name, "Nancy");
  assert.equal(radarSite("chalb")?.name, "Albis");
  assert.equal(radarSite("czbrd")?.name, "Brdy");
  assert.equal(radarSite("plpoz")?.name, "Poznań");
});

test("a volume from before every network joined names DWD's radars by their bare code", () => {
  assert.equal(radarSite("isn")?.name, "Isen");
  assert.equal(radarSite("ISN")?.name, "Isen");
});

test("a border storm's radars are listed nearest first, from both sides", () => {
  // Strasbourg: Offenthal is 150 km away, Nancy 90.
  const listed = contributions(["deoft", "frnan"], 48.58, 7.75);

  assert.deepEqual(listed.map((radar) => radar.code), ["frnan", "deoft"]);
  assert.ok((listed[0].distanceKm ?? 0) < (listed[1].distanceKm ?? 0));
});

test("each network's lowest beam is its own tilt", () => {
  // The Swiss -0.2 degree tilt sits lower at the same range than DWD's 0.5.
  const [swiss] = contributions(["chalb"], 47.284332, 9.9);
  const [german] = contributions(["demem"], 48.042145, 11.6);
  assert.ok(swiss.lowestBeamKm !== null && german.lowestBeamKm !== null);
  assert.ok(swiss.lowestBeamKm - 0.938 < german.lowestBeamKm - 0.7244);
});

test("a radar the table does not know keeps its code", () => {
  const [unknown] = contributions(["xxabc"], 50, 10);
  assert.equal(unknown.name, "XXABC");
  assert.equal(unknown.distanceKm, null);
});
