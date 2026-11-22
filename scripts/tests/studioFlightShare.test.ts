import assert from "node:assert/strict";
import { test } from "node:test";
import { flightLinkQuery, readFlightLink, readSnapshot, withoutFlightLink, writeSnapshot } from "../../src/lib/studio/flightLink.ts";
import type { FlightPlan } from "../../src/lib/studio/flight/plan.ts";
import { resumedPlan } from "../../src/lib/studio/flight/plan.ts";

const snapshot = {
  v: 1, at: "2026-11-22T14:03:11.000Z", scan: "2026-11-22T14:00:00.000Z", weather: "live",
  where: { lon: 10.2412345, lat: 46.3112345, altitude: 3962.4, ground: 2100 },
  state: { lon: 10.2412345, lat: 46.3112345, altitude: 3962.4, heading: 47.5, pitch: 3.2, roll: -21.5, tas: 160 },
  damage: { lost: { surfaces: ["rightAileron"] } }, view: "outside", style: "glow", radarOnGround: false, gearDown: true,
  note: "Grüße ✈",
};

test("a moment of a flight goes into its link and comes back the same", () => {
  const start = { lat: 46.3112, lon: 10.2412, heading: 47.5, altitude: 3962.4, speed: { knots: 256 }, view: "outside" as const, snapshot };
  const query = flightLinkQuery(start);
  // The plain keys still lead it, for whatever reads only those.
  assert.match(query, /^fly=46\.3112,10\.2412&hdg=048&alt=FL130&spd=256kt&view=outside&s=[A-Za-z0-9_-]+$/);
  assert.deepEqual(readFlightLink(`?${query}`)?.snapshot, snapshot);
  assert.equal(withoutFlightLink(`?${query}&layer=radar`), "?layer=radar");
});

test("a snapshot that is not one is no snapshot, and the start still flies", () => {
  assert.equal(readSnapshot("not base64!"), null);
  assert.equal(readSnapshot(writeSnapshot([1, 2] as unknown as Record<string, unknown>)), null);
  const link = readFlightLink("?fly=46.3,10.2&s=%%%");
  assert.ok(link && link.snapshot === undefined && link.lat === 46.3);
});

test("a flight taken off from a moment starts where that one was, as it was seen", () => {
  const plan: FlightPlan = {
    aircraft: "a320", lon: 9, lat: 45, heading: 0, altitude: 5000, tas: 200, target: null, aimed: true,
    view: "cockpit", style: "sky", radarOnGround: true, marks: true,
  };
  const resumed = resumedPlan(plan, snapshot);
  assert.deepEqual(
    [resumed.lon, resumed.lat, resumed.heading, resumed.altitude, resumed.tas, resumed.aimed],
    [10.2412345, 46.3112345, 47.5, 3962.4, 160, false],
  );
  assert.deepEqual([resumed.view, resumed.style, resumed.radarOnGround, resumed.marks], ["outside", "glow", false, true]);
  assert.equal(resumed.resume, snapshot);
  // What a link gets wrong stays as planned.
  const odd = resumedPlan(plan, { state: { lon: "x", altitude: 1e9 }, style: "neon" });
  assert.deepEqual([odd.lon, odd.altitude, odd.style], [9, 15_000, "sky"]);
});

test("the storm that one was flown at is flown at again where the radar still has it", () => {
  const plan: FlightPlan = {
    aircraft: "a320", lon: 9, lat: 45, heading: 0, altitude: 5000, tas: 200, target: null, aimed: true,
    view: "cockpit", style: "sky", radarOnGround: true, marks: true,
  };
  const system = (lon: number, lat: number) => ({ lon, lat, radiusKm: 10, peakDbz: 55, strength: 1, strikes: 0, tiles: 1, extent: [] });
  const [moved, other] = [system(9.1, 45.43), system(9.6, 45.43)];
  const flownAt = { ...snapshot, target: { lon: 9.07, lat: 45.43, peakDbz: 62.5 } };
  assert.equal(resumedPlan(plan, flownAt, [other, moved]).target, moved);
  // Gone from the radar: the plan's own.
  assert.equal(resumedPlan(plan, flownAt, [other]).target, null);
});
