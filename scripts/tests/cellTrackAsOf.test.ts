import assert from "node:assert/strict";
import test from "node:test";
import type { CellStep, CellTrack } from "../../src/api/index.ts";
import { trackAsOf } from "../../src/lib/cellTrack.ts";

/**
 * A storm drawn on an earlier frame: the track as it stood then, cut out of
 * the answer the map already holds.
 */

const minute = (m: number) => Date.UTC(2026, 9, 10, 14, m);

const step = (m: number, severity: number, lon: number): CellStep => ({
  t: new Date(minute(m)).toISOString(),
  lon,
  lat: 54.5,
  severity,
  max_dbz: 40 + severity * 5,
} as CellStep);

/** Four detections, 14:00 to 14:15, a split at the end and an outline and forecast from the last. */
const track = (): CellTrack => {
  const series = [step(0, 0, 9.0), step(5, 1, 9.1), step(10, 2, 9.2), step(15, 1, 9.3)];
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: series.map((s) => [s.lon, s.lat]) },
    properties: {
      code: "A",
      active: false,
      first_seen: series[0].t,
      last_seen: series[3].t,
      n_steps: 4,
      series,
      max_severity: 2,
      max_dbz: 50,
      child_codes: ["B", "C"],
      polygon: [[9.3, 54.4], [9.4, 54.5], [9.3, 54.6]],
      forecast: [{ t: new Date(minute(20)).toISOString(), lon: 9.4, lat: 54.5 }],
    },
  } as unknown as CellTrack;
};

test("a storm not yet detected at the moment is not drawn", () => {
  assert.equal(trackAsOf(track(), minute(0) - 1), null);
});

test("a storm detected for the last time by the moment is as it ended", () => {
  const then = trackAsOf(track(), minute(15))!;
  assert.equal(then.properties.series!.length, 4);
  assert.deepEqual(then.properties.child_codes, ["B", "C"]);
});

test("a storm last seen by the moment is active for the backend's twenty minutes after", () => {
  assert.equal(trackAsOf(track(), minute(35))!.properties.active, true);
  assert.equal(trackAsOf(track(), minute(36))!.properties.active, false);
});

test("a storm still going is cut after the last detection at or before the moment", () => {
  const then = trackAsOf(track(), minute(7))!;
  const p = then.properties;

  assert.equal(p.series!.length, 2);
  assert.deepEqual(then.geometry.coordinates, [[9.0, 54.5], [9.1, 54.5]]);
  assert.equal(p.last_seen, new Date(minute(5)).toISOString());
  assert.equal(p.n_steps, 2);
});

test("a cut storm is active and childless, without what only its last detection had", () => {
  const p = trackAsOf(track(), minute(10))!.properties;

  assert.equal(p.active, true);
  assert.deepEqual(p.child_codes, []);
  assert.deepEqual(p.forecast, []);
  assert.equal(p.polygon, null);
});

test("a cut storm's colour is its worst so far, not its worst ever", () => {
  assert.equal(trackAsOf(track(), minute(5))!.properties.max_severity, 1);
  assert.equal(trackAsOf(track(), minute(5))!.properties.max_dbz, 45);
  assert.equal(trackAsOf(track(), minute(12))!.properties.max_severity, 2);
});
