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
