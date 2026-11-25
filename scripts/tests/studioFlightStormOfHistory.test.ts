import assert from "node:assert/strict";
import { test } from "node:test";
import { historyCandidates } from "../../src/lib/studio/flight/stormOfHistory.ts";

const coverage = { since: Date.parse("2026-11-22T00:00Z") / 1000, until: Date.parse("2026-11-25T00:00Z") / 1000 };

const storm = (born: string, last: string, rating: number, peak = 60, lon = 4, lat = 44) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon + 1, lat] },
  properties: {
    born_at: born, last_seen: last, rating, peak_dbz: peak,
    path: { type: "LineString", coordinates: [[lon, lat], [lon + 0.5, lat], [lon + 1, lat]] },
  },
}) as never;

test("the history's storms are ranked by how much they mattered, for as long as they lasted, at the middle of their life", () => {
  const found = historyCandidates([
    storm("2026-11-23T10:00Z", "2026-11-23T11:00Z", 2.0),
    storm("2026-11-22T13:00Z", "2026-11-22T15:00Z", 1.8, 60, 0, 45),
  ], coverage);
  // Two hours at 1.8 outweighs one at 2.0.
  assert.equal(found[0].at, Date.parse("2026-11-22T14:00Z") / 1000);
  assert.deepEqual([found[0].lon, found[0].lat], [0.5, 45]);
  assert.equal(found[1].at, Date.parse("2026-11-23T10:30Z") / 1000);
});

test("clutter and storms the history no longer keeps are left out", () => {
  assert.deepEqual(historyCandidates([
    // A blip: strong, but a quarter of an hour.
    storm("2026-11-23T10:00Z", "2026-11-23T10:15Z", 3, 76),
    // Weak echo.
    storm("2026-11-23T10:00Z", "2026-11-23T12:00Z", 1, 40),
    // Its middle before the history begins.
    storm("2026-11-21T22:00Z", "2026-11-22T00:30Z", 2),
  ], coverage), []);
});
