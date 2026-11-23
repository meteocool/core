import assert from "node:assert/strict";
import test from "node:test";
import {
  pointAlong, RAY_FAINTEST, radarsOf, rayGrowth, rayRuns, rayStrength, RAYS_MOST, runsFrom,
} from "../../src/lib/studio/flight/radarRays.ts";
import type { Vec3 } from "../../src/lib/studio/flight/view.ts";
import { radarSite } from "../../src/lib/radarSites.ts";

// Over the Po valley, as demo's replay has it: Monte Lema saw it, and nothing else does there.
const storm = { lon: 9.2, lat: 45.6 };
const tile = (lon: number, lat: number, sites: string[], coarse = false) => ({ lon, lat, coarse, sites });

test("a storm's radars are those of the volumes around it", () => {
  const radars = radarsOf(storm, [tile(9.21, 45.61, ["chlem"]), tile(9.3, 45.55, ["chlem", "chalb"])]);
  assert.deepEqual(radars.map((radar) => radar.code), ["chlem", "chalb"]);
});

test("a volume of another storm further off lends it no radars", () => {
  const radars = radarsOf(storm, [tile(9.21, 45.61, ["chlem"]), tile(10.2, 45.6, ["chalb"])]);
  assert.deepEqual(radars.map((radar) => radar.code), ["chlem"]);
});

test("with no volume round it, the nearest one close enough stands in", () => {
  const radars = radarsOf(storm, [tile(9.55, 45.6, ["chlem"])]);
  assert.deepEqual(radars.map((radar) => radar.code), ["chlem"]);
});

test("a storm with no volume anywhere near has no radars", () => {
  assert.deepEqual(radarsOf(storm, [tile(11.5, 47.0, ["chlem"])]), []);
});

test("coarse volumes are passed over where finer ones are listed", () => {
  const radars = radarsOf(storm, [tile(9.2, 45.6, ["chalb"], true), tile(9.25, 45.62, ["chlem"])]);
  assert.deepEqual(radars.map((radar) => radar.code), ["chlem"]);
});

test("radars the table does not know are left out, and one named twice is one", () => {
  assert.ok(radarSite("deisn"));
  const radars = radarsOf({ lon: 12.1, lat: 48.2 }, [tile(12.1, 48.2, ["isn", "deisn", "xxnowhere"])]);
  assert.equal(radars.length, 1);
});

test("the nearest radar comes first, and no more are given than are drawn", () => {
  const codes = ["deisn", "demem", "deeis", "detur", "defld", "deneu", "dendr", "debbg", "deumd", "deoft"];
  const radars = radarsOf({ lon: 11, lat: 49 }, [tile(11, 49, codes)]);
  assert.equal(radars.length, RAYS_MOST);
  for (let index = 1; index < radars.length; index++) assert.ok(radars[index - 1].distanceKm <= radars[index].distanceKm);
});

test("a beam is brighter the lower its radar saw into the storm", () => {
  assert.equal(rayStrength(0.5), 1);
  assert.ok(rayStrength(2) < rayStrength(1.5));
  assert.equal(rayStrength(9), RAY_FAINTEST);
});

// An eye looking north, level: north is ahead, east to the right, down down.
const project = ([north, east, down]: Vec3) => (north <= 1 ? null : { x: 0.5 + (0.5 * east) / north, y: 0.5 + (0.5 * down) / north });

test("a beam wholly ahead is one run, from the radar to the storm", () => {
  const runs = rayRuns([10_000, -2000, 500], [5000, 1000, -3000], project, undefined, 10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0][0].t, 0);
  assert.equal(runs[0].at(-1)!.t, 1);
});

test("a beam from a radar behind the eye starts where it comes into sight", () => {
  const runs = rayRuns([-20_000, 0, 500], [20_000, 0, -3000], project, undefined, 10);
  assert.equal(runs.length, 1);
  assert.ok(runs[0][0].t > 0.5);
  assert.equal(runs[0].at(-1)!.t, 1);
});

test("a beam is broken where something hides it, and goes on beyond", () => {
  const hidden = ([north]: Vec3) => north < 8000 || north > 12_000;
  const runs = rayRuns([4000, 0, 0], [16_000, 0, 0], project, hidden, 12);
  assert.equal(runs.length, 2);
  assert.ok(runs[0].at(-1)!.t < runs[1][0].t);
});

test("a point along a beam is found in the run that holds it, and nowhere in a gap", () => {
  const runs = [[{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 0.4 }], [{ x: 2, y: 0, t: 0.6 }, { x: 3, y: 0, t: 1 }]];
  assert.deepEqual(pointAlong(runs, 0.2), { x: 0.5, y: 0 });
  assert.equal(pointAlong(runs, 0.5), null);
  assert.deepEqual(pointAlong(runs, 1), { x: 3, y: 0 });
});

test("beams grow out from the storm, and are whole soon after it is picked", () => {
  assert.equal(rayGrowth(0), 0);
  assert.ok(rayGrowth(0.3) > 0.3);
  assert.equal(rayGrowth(5), 1);
});

test("a beam partly grown is cut where it has grown to, its start moved onto the cut", () => {
  const runs = [[{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 0.5 }, { x: 2, y: 0, t: 1 }]];
  assert.deepEqual(runsFrom(runs, 0.75), [[{ x: 1.5, y: 0, t: 0.75 }, { x: 2, y: 0, t: 1 }]]);
  assert.deepEqual(runsFrom(runs, 0), runs);
  assert.deepEqual(runsFrom([[{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 0.3 }]], 0.5), []);
});
