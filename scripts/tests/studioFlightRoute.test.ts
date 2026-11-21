import assert from "node:assert/strict";
import test from "node:test";
import { indicatedFromTrue, machOf, speedOfSound } from "../../src/lib/studio/flight/atmosphere.ts";
import { bearingDeg, destination, distanceM, wrap180 } from "../../src/lib/studio/flight/geo.ts";
import { MMO, VMO_MS } from "../../src/lib/studio/flight/physics.ts";
import {
  ALTITUDE_RANGE, CRUISE_KNOTS, CRUISE_MACH, cruiseSpeed, headed, nextStorm, planHere, retargeted, startOf, stormLevel,
} from "../../src/lib/studio/flight/plan.ts";
import { stormSystems, terrainFloor } from "../../src/lib/studio/flight/spawn.ts";
import type { StormTile } from "../../src/lib/studio/flight/spawn.ts";
import { flightLinkQuery, flightLinkUrl, readFlightLink, withoutFlightLink } from "../../src/lib/studio/flightLink.ts";
import type { FlightStart } from "../../src/lib/studio/flightLink.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);
const FEET = 3.28084;
const KNOTS = 1.943844;
const fl = (metres: number) => Math.round((metres * FEET) / 100);

const tile = (lon: number, lat: number, peakDbz: number, patch: Partial<StormTile> = {}): StormTile => ({
  lon, lat, peakDbz, areaKm2: 400, coarse: true, tile: [9, 0, 0], ...patch,
});

/** From a place with nothing fixed: everything chosen for the storm. */
const open = (lon: number, lat: number, patch: Partial<FlightStart> = {}): FlightStart => ({
  lat, lon, heading: null, altitude: null, speed: null, view: "cockpit", ...patch,
});
const flat = () => 100;

/* ---- the next storm ---- */

test("the next storm is the one a place stands in, else the one whose rain is nearest of those worth flying at", () => {
  const strong = tile(4.0, 43.5, 58);
  const shower = tile(6.0, 45.0, 40);
  const drizzle = tile(5.0, 44.6, 25);
  const systems = stormSystems([strong, shower, drizzle]);
  const [atStrong, atShower, atDrizzle] = [strong, shower, drizzle].map((one) => systems.find((system) => system.peakDbz === one.peakDbz)!);
  // Inside one: that one, whatever is stronger nearby.
  assert.equal(nextStorm(6.02, 45.01, systems), atShower);
  assert.equal(nextStorm(5.0, 44.6, systems), atDrizzle);
  // Outside: the nearest shower or storm; drizzle is passed over while there are those.
  assert.equal(nextStorm(4.5, 43.9, systems), atStrong);
  assert.equal(nextStorm(6.6, 45.4, systems), atShower);
  // Nearer the drizzle's edge than any other's, and still the storm.
  assert.equal(nextStorm(5.0, 44.1, systems), atStrong);
  // Drizzle alone is still somewhere to fly.
  assert.equal(nextStorm(5.5, 44.6, stormSystems([drizzle]))?.peakDbz, 25);
  assert.equal(nextStorm(5, 45, []), null);
});

test("beside a long line of storms is not in it: the storm whose rain is nearer is the next one", () => {
  const line = Array.from({ length: 7 }, (_, i) => tile(4.0, 42.0 + i * 0.45, 55));
  const cell = tile(5.3, 43.35, 60);
  const systems = stormSystems([...line, cell]);
  assert.equal(systems.length, 2);
  // Well within the line's radius, half way along it, and nearer the single storm's rain.
  assert.equal(nextStorm(4.75, 43.35, systems)?.tiles, 1);
  // In the line's rain, its core.
  assert.equal(nextStorm(4.05, 42.9, systems)?.tiles, 7);
});

/* ---- the level and the speed ---- */

test("a weak shower is flown low, a strong storm at mid levels, to the thousand feet", () => {
  assert.equal(fl(stormLevel(30)), 90);
  assert.equal(fl(stormLevel(35)), 90);
  assert.equal(fl(stormLevel(45)), 150);
  assert.equal(fl(stormLevel(55)), 200);
  assert.equal(fl(stormLevel(60)), 230);
  assert.equal(fl(stormLevel(70)), 230);
  assert.equal(fl(stormLevel(null)), 100);
  for (const dbz of [20, 38, 47, 52, 63]) assert.equal(fl(stormLevel(dbz)) % 10, 0);
});

test("rather fast: 300 kt indicated low down, Mach 0.78 high up, and never past the limits", () => {
  const low = 3000;
  near(indicatedFromTrue(cruiseSpeed(low), low) * KNOTS, CRUISE_KNOTS, 0.01);
  assert.ok(machOf(cruiseSpeed(low), low) < CRUISE_MACH);
  const high = 11_000;
  near(machOf(cruiseSpeed(high), high), CRUISE_MACH, 1e-9);
  assert.ok(indicatedFromTrue(cruiseSpeed(high), high) * KNOTS < CRUISE_KNOTS);
  // Faster through the air the higher it goes, and short of 350 kt and Mach 0.82 everywhere.
  let last = 0;
  for (let altitude = ALTITUDE_RANGE[0]; altitude <= ALTITUDE_RANGE[1]; altitude += 250) {
    const tas = cruiseSpeed(altitude);
    assert.ok(indicatedFromTrue(tas, altitude) < VMO_MS - 15, `IAS at ${altitude} m`);
    assert.ok(machOf(tas, altitude) < MMO - 0.03, `Mach at ${altitude} m`);
    if (altitude < 8000) assert.ok(tas > last);
    last = tas;
  }
});

/* ---- the plan ---- */

test("a flight from a place starts there, nose on the next storm, in its cloud at the level its strength asks for", () => {
  const systems = stormSystems([tile(4.0, 43.5, 58), tile(9.0, 50.0, 40)]);
  const plan = planHere(open(3.2, 43.9), systems, flat, 20, "sky");
  assert.equal(plan.lon, 3.2);
  assert.equal(plan.lat, 43.9);
  assert.equal(plan.target?.peakDbz, 58);
  assert.equal(plan.aimed, true);
  near(wrap180(plan.heading - bearingDeg(3.2, 43.9, plan.target!.lon, plan.target!.lat)), 0, 1e-6);
  assert.ok(fl(plan.altitude) >= 160 && fl(plan.altitude) <= 240, `FL${fl(plan.altitude)}`);
  near(plan.tas, cruiseSpeed(plan.altitude), 1e-9);
  // As the plan the flight would fly unasked has it: from the cockpit, the radar's colours off the ground, the storms marked.
  assert.equal(plan.view, "cockpit");
  assert.equal(plan.style, "sky");
  assert.equal(plan.radarOnGround, false);
  assert.equal(plan.marks, true);
  // A weak shower is flown low.
  const shower = planHere(open(9.5, 50.3), systems, flat, 0, "sky");
  assert.equal(shower.target?.peakDbz, 40);
  assert.ok(fl(shower.altitude) >= 80 && fl(shower.altitude) <= 120, `FL${fl(shower.altitude)}`);
});

test("from inside a storm the nose is on its core; in the core, and with no weather, it is the map's way", () => {
  const systems = stormSystems([tile(4.0, 43.5, 58)]);
  const core = systems[0];
  const [lon, lat] = destination(core.lon, core.lat, 300, 12_000);
  const inside = planHere(open(lon, lat), systems, flat, 0, "sky");
  assert.equal(inside.target, core);
  near(inside.heading, bearingDeg(lon, lat, core.lon, core.lat), 1e-6);
  const onIt = planHere(open(core.lon, core.lat), systems, flat, 77, "sky");
  assert.equal(onIt.heading, 77);
  assert.equal(onIt.aimed, false);
  const clear = planHere(open(4, 43), [], flat, 250, "sky");
  assert.equal(clear.target, null);
  assert.equal(clear.heading, 250);
  // FL100, or the 3,000 m over the ground an approach keeps: here 100 m up, so FL110.
  assert.equal(fl(clear.altitude), 110);
  assert.equal(fl(planHere(open(4, 43), [], () => 0, 0, "sky").altitude), 100);
});

test("the level is raised over the ground ahead, by the margin an approach keeps; with none loaded, over the range's summit", () => {
  const systems = stormSystems([tile(1.0, 42.8, 40)]);
  // A shower wants FL120 or so; ground of 2,600 m ahead asks for 5,600 m, FL184, rounded up to FL190.
  const raised = planHere(open(0.2, 42.6), systems, (lon) => (lon > 0.4 ? 2600 : 900), 0, "sky");
  near(terrainFloor(0.2, 42.6, raised.heading, (lon) => (lon > 0.4 ? 2600 : 900))!, 5600, 1e-9);
  assert.equal(fl(raised.altitude), 190);
  // No ground loaded: 2,000 ft over the Pyrenees' highest summit, 3,404 m.
  const blind = planHere(open(0.2, 42.6), systems, () => null, 0, "sky");
  assert.ok(blind.altitude >= 3404 + 610 - 1, `FL${fl(blind.altitude)}`);
  assert.equal(fl(blind.altitude) % 10, 0);
  // Over the plains nothing is raised.
  assert.equal(terrainFloor(-1, 47, 90, () => null), null);
});

test("what a start fixes is kept: heading, level, speed (held short of the limit) and view", () => {
  const systems = stormSystems([tile(4.0, 43.5, 58)]);
  const plan = planHere(open(3.2, 43.9, { heading: 45, altitude: 18_000 / FEET, speed: { knots: 280 }, view: "outside" }), systems, flat, 0, "sky");
  assert.equal(plan.heading, 45);
  assert.equal(plan.aimed, false);
  assert.equal(plan.target?.peakDbz, 58);
  assert.equal(fl(plan.altitude), 180);
  near(indicatedFromTrue(plan.tas, plan.altitude) * KNOTS, 280, 0.01);
  assert.equal(plan.view, "outside");
  const mach = planHere(open(3.2, 43.9, { altitude: 35_000 / FEET, speed: { mach: 0.8 } }), systems, flat, 0, "sky");
  near(machOf(mach.tas, mach.altitude), 0.8, 1e-9);
  // Not past 340 kt, nor out of the speeds a flight starts at.
  const fast = planHere(open(3.2, 43.9, { altitude: 10_000 / FEET, speed: { knots: 440 } }), systems, flat, 0, "sky");
  near(indicatedFromTrue(fast.tas, fast.altitude) * KNOTS, 340, 0.01);
  const high = planHere(open(3.2, 43.9, { altitude: 80_000 / FEET }), systems, flat, 0, "sky");
  assert.equal(high.altitude, ALTITUDE_RANGE[1]);
  assert.ok(machOf(high.tas, high.altitude) <= 0.82 + 1e-9);
  near(speedOfSound(high.altitude) * CRUISE_MACH, high.tas, 1e-9);
});

/* ---- the link ---- */

test("a flight's link reads back what it was written from, and says it short", () => {
  const start: FlightStart = { lat: 43.30121, lon: 4.60009, heading: 45, altitude: 18_000 / FEET, speed: { knots: 300 }, view: "outside" };
  const query = flightLinkQuery(start);
  assert.equal(query, "fly=43.3012,4.6001&hdg=045&alt=FL180&spd=300kt&view=outside");
  const back = readFlightLink(`?${query}`)!;
  near(back.lat, 43.3012, 1e-9);
  near(back.lon, 4.6001, 1e-9);
  assert.equal(back.heading, 45);
  near(back.altitude!, 18_000 / FEET, 1e-6);
  assert.deepEqual(back.speed, { knots: 300 });
  assert.equal(back.view, "outside");
  assert.equal(flightLinkUrl("https://meteocool.com/", { ...start, heading: null, altitude: null, speed: { mach: 0.78 }, view: "cockpit" }),
    "https://meteocool.com/meteoair.html?fly=43.3012,4.6001&spd=M0.78");
  // Only where to start is needed: the rest is chosen for the storm.
  assert.deepEqual(readFlightLink("?fly=43.3,4.6"), { lat: 43.3, lon: 4.6, heading: null, altitude: null, speed: null, view: "cockpit" });
});

test("a flight's link takes a level and a speed however a person writes them, and leaves out what makes no sense", () => {
  const read = (query: string) => readFlightLink(`?fly=46.5,10.5&${query}`)!;
  near(read("alt=fl240").altitude!, 24_000 / FEET, 1e-6);
  near(read("alt=24000ft").altitude!, 24_000 / FEET, 1e-6);
  near(read("alt=9500").altitude!, 9500 / FEET, 1e-6);
  assert.deepEqual(read("spd=m.78").speed, { mach: 0.78 });
  assert.deepEqual(read("spd=0.8").speed, { mach: 0.8 });
  assert.deepEqual(read("spd=280").speed, { knots: 280 });
  assert.deepEqual(read("spd=280kts").speed, { knots: 280 });
  assert.equal(read("hdg=360").heading, 0);
  // Out of reason, or not a number: as if not said.
  assert.equal(read("alt=FL900").altitude, null);
  assert.equal(read("alt=high").altitude, null);
  assert.equal(read("spd=900kt").speed, null);
  assert.equal(read("spd=M1.5").speed, null);
  assert.equal(read("hdg=400").heading, null);
  assert.equal(read("hdg=-10").heading, null);
  assert.equal(read("view=sideways").view, "cockpit");
  // No start, or one off the map: no flight.
  assert.equal(readFlightLink("?latLonZ=50,10,6"), null);
  assert.equal(readFlightLink("?fly=95,10"), null);
  assert.equal(readFlightLink("?fly=46.5"), null);
  assert.equal(readFlightLink("?fly=here"), null);
});

test("once the flight is over its part of the address goes, and the rest stays as it was written", () => {
  assert.equal(withoutFlightLink("?latLonZ=50.5,9.5,6.00&fly=43.3,4.6&hdg=045&alt=FL180&spd=300kt&view=outside"), "?latLonZ=50.5,9.5,6.00");
  assert.equal(withoutFlightLink("?fly=43.3,4.6"), "");
  assert.equal(withoutFlightLink(""), "");
});

test("a plan's start as a link: the nose left to the next storm where it is on it, the speed as the level flies it", () => {
  const tiles = [tile(4.0, 43.5, 58), tile(1.0, 45.5, 50)];
  const systems = stormSystems(tiles);
  const plan = planHere(open(3.2, 43.9), systems, flat, 0, "sky");
  const start = startOf(plan, systems);
  assert.equal(start.heading, null);
  assert.ok(start.speed && "knots" in start.speed);
  assert.equal((start.speed as { knots: number }).knots, 300);
  // Opened again, the same start: place, nose, level and speed.
  const again = planHere(readFlightLink(`?${flightLinkQuery(start)}`)!, systems, flat, 0, "sky");
  near(distanceM(again.lon, again.lat, plan.lon, plan.lat), 0, 10);
  near(wrap180(again.heading - plan.heading), 0, 0.1);
  near(again.altitude, plan.altitude, 15);
  near(again.tas, plan.tas, 1);
  // Turned by hand, or at another storm than the next: the heading is written.
  assert.equal(startOf(headed(plan, 123.4), systems).heading, 123);
  const other = retargeted(plan, systems.find((system) => system.peakDbz === 50)!, tiles);
  assert.notEqual(startOf({ ...other, lon: plan.lon, lat: plan.lat }, systems).heading, null);
  // High up, a Mach number.
  const high = { ...plan, altitude: 35_000 / FEET, tas: 0.78 * speedOfSound(35_000 / FEET) };
  assert.deepEqual(startOf(high, systems).speed, { mach: 0.78 });
});
