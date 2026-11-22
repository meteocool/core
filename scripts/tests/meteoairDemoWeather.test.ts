import assert from "node:assert/strict";
import { test } from "node:test";
import { isFlightPage, weatherChoice } from "../../src/weatherSource.ts";
import { worthFlying, WORTHY_DBZ, WORTHY_STRIKES } from "../../src/lib/studio/flight/fallback.ts";
import { flightLinkUrl } from "../../src/lib/studio/flightLink.ts";

const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

test("only the flight's page takes the demo's weather from its address", () => {
  assert.ok(isFlightPage(at("/meteoair.html")) && isFlightPage(at("/meteoair")) && isFlightPage(at("/", "", "#meteoair")));
  assert.ok(!isFlightPage(at("/")) && !isFlightPage(at("/index.html", "", "#map")));
  assert.equal(weatherChoice(at("/meteoair.html", "?weather=demo")), "demo");
  assert.equal(weatherChoice(at("/meteoair.html", "?weather=LIVE")), "live");
  assert.equal(weatherChoice(at("/meteoair.html", "?weather=other")), null);
  // The radar map never: a link there with it is the live map.
  assert.equal(weatherChoice(at("/", "?weather=demo")), null);
});

test("a storm is worth flying with a heavy core and lightning going on in it, not rain alone", () => {
  assert.ok(worthFlying([{ peakDbz: WORTHY_DBZ, strikes: WORTHY_STRIKES }]));
  // Sea clutter at 59 dBZ with no lightning, and a stray flash in a shower, are not.
  assert.ok(!worthFlying([{ peakDbz: 59, strikes: 0 }, { peakDbz: 38, strikes: 40 }, { peakDbz: 52, strikes: WORTHY_STRIKES - 1 }]));
  assert.ok(!worthFlying([]));
});

test("a flight over the demo's storm says so in its link", () => {
  const start = { lat: 45.3, lon: 9.3, heading: null, altitude: null, speed: null, view: "cockpit" as const };
  assert.ok(flightLinkUrl("https://meteocool.com", start, true).endsWith("&weather=demo"));
  assert.ok(!flightLinkUrl("https://meteocool.com", start, false).includes("weather="));
});

test("the demo's Lombardy storm is flown at from over the Alps, at FL130 and 256 kt", async () => {
  const { showcasePlan, flightLevel } = await import("../../src/lib/studio/flight/plan.ts");
  const { indicatedFromTrue } = await import("../../src/lib/studio/flight/atmosphere.ts");
  const { bearingDeg } = await import("../../src/lib/studio/flight/geo.ts");
  const storm = { lon: 9.31, lat: 45.34, radiusKm: 80, peakDbz: 60, strength: 1, strikes: 85, tiles: 4, extent: [] };
  const plan = showcasePlan(storm, "realistic" as never);
  assert.ok(plan);
  assert.ok(Math.abs(plan.lon - 10.24) < 1e-9 && Math.abs(plan.lat - 46.31) < 1e-9);
  assert.equal(flightLevel(plan.altitude), "FL130");
  assert.equal(Math.round(indicatedFromTrue(plan.tas, plan.altitude) * 1.943844), 256);
  assert.ok(Math.abs(plan.heading - bearingDeg(10.24, 46.31, 9.31, 45.34)) < 1e-9 && plan.aimed);
  // Any other storm keeps the usual rules.
  assert.equal(showcasePlan({ ...storm, lon: 2.3, lat: 48.8 }, "realistic" as never), null);
});

test("a flight's link is made on app.meteocool.com on production, which the apps claim; elsewhere on its own site", async () => {
  const { flightLinkOrigin } = await import("../../src/lib/studio/flightLink.ts");
  assert.equal(flightLinkOrigin("https://meteocool.com", true), "https://app.meteocool.com");
  assert.equal(flightLinkOrigin("https://app.meteocool.com", true), "https://app.meteocool.com");
  assert.equal(flightLinkOrigin("https://next.meteocool.com", false), "https://next.meteocool.com");
});

test("a moment shared over the demo's storm is flown over it again, unless the address says otherwise", async () => {
  const { writeSnapshot } = await import("../../src/lib/studio/snapshot.ts");
  const demo = writeSnapshot({ weather: "demo" });
  assert.equal(weatherChoice(at("/meteoair.html", `?fly=45.3,9.3&s=${demo}`)), "demo");
  assert.equal(weatherChoice(at("/meteoair.html", `?fly=45.3,9.3&s=${writeSnapshot({ weather: "live" })}`)), "live");
  assert.equal(weatherChoice(at("/meteoair.html", `?fly=45.3,9.3&s=${demo}&weather=live`)), "live");
  assert.equal(weatherChoice(at("/", `?s=${demo}`)), null);
});
