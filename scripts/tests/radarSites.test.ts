import assert from "node:assert/strict";
import test from "node:test";
import { contributions, radarSite } from "../../src/lib/radarSites.ts";

test("a radar is found by its node code, whichever network it reports through", () => {
  assert.equal(radarSite("deisn")?.name, "Isen");
  assert.equal(radarSite("frnan")?.name, "Nancy");
  assert.equal(radarSite("chalb")?.name, "Albis");
  assert.equal(radarSite("czbrd")?.name, "Brdy");
  assert.equal(radarSite("plpoz")?.name, "Poznań");
  assert.equal(radarSite("bejab")?.name, "Jabbeke");
  assert.equal(radarSite("skkoj")?.name, "Kojšovská hoľa");
  assert.equal(radarSite("ltvil")?.name, "Vilnius (Trakų Vokė)");
  assert.equal(radarSite("eesur")?.name, "Sürgavere");
  assert.equal(radarSite("iedub")?.name, "Dublin");
  assert.equal(radarSite("hrgol")?.name, "Goli");
  assert.equal(radarSite("dkste")?.name, "Stevns");
  assert.equal(radarSite("nlhrw")?.name, "Herwijnen");
  assert.equal(radarSite("fivih")?.name, "Vihti");
  assert.equal(radarSite("sebaa")?.name, "Bålsta");
  assert.equal(radarSite("nohur")?.name, "Hurum");
});

test("each radar reaches as far as its own files do, read no further than 250 km", () => {
  assert.equal(radarSite("ltlau")?.rangeKm, 249.3);
  assert.equal(radarSite("eehar")?.rangeKm, 249.9);
  assert.equal(radarSite("iedub")?.rangeKm, 250);
  assert.equal(radarSite("iesha")?.rangeKm, 248.5);
  assert.equal(radarSite("hrbil")?.rangeKm, 249.8);
  assert.equal(radarSite("dkbor")?.rangeKm, 238);
  // KNMI's files run to 320 km.
  assert.equal(radarSite("nldhl")?.rangeKm, 250);
  assert.equal(radarSite("fikau")?.rangeKm, 250);
  assert.equal(radarSite("sekrn")?.rangeKm, 240);
  assert.equal(radarSite("nosta")?.rangeKm, 240);
});

test("a Finnish radar's lowest tilt is its own site's", () => {
  assert.equal(radarSite("fivih")?.lowestDeg, 0.3);
  assert.equal(radarSite("fikor")?.lowestDeg, 0.5);
  assert.equal(radarSite("filuo")?.lowestDeg, 0.1);
});

test("each Belgian radar reaches as far as its own files do", () => {
  assert.equal(radarSite("behel")?.rangeKm, 200);
  assert.equal(radarSite("bejab")?.rangeKm, 250);
  assert.equal(radarSite("bewid")?.rangeKm, 250);
});

test("a Slovak radar's lowest beam is level as it leaves the antenna", () => {
  // Bratislava, 16 km from Malý Javorník: SHMÚ's 0.0 degree tilt is still at the site's own height.
  const [javornik] = contributions(["skjav"], 48.15, 17.11);
  assert.ok(javornik.lowestBeamKm !== null);
  assert.ok(javornik.lowestBeamKm > 0.6 && javornik.lowestBeamKm < 0.65);
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
