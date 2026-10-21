import assert from "node:assert/strict";
import test from "node:test";
import { aheadOf, describeReading, MAX_AGE_S, sweepAt, tiltNear } from "../../src/lib/siteSweeps.ts";
import { velocityTable, VELOCITY_CALM, VELOCITY_NO_ECHO, VELOCITY_UNRESOLVED } from "../../src/colormaps.ts";
import { motionOf } from "../../src/lib/stormSelection.ts";

const at = (minute: number) => ({ scanned_at: new Date(Date.UTC(2026, 9, 9, 18, minute)).toISOString(), path: `p${minute}` });
const step = (minute: number) => Date.UTC(2026, 9, 9, 18, minute) / 1000;
const SCANS = [at(0), at(5), at(10), at(15)];

test("a step shows the newest sweep scanned by then", () => {
  assert.equal(sweepAt(SCANS, step(12), false)?.path, "p10");
  assert.equal(sweepAt(SCANS, step(10), false)?.path, "p10");
});

test("a step with nothing recent enough shows no sweep rather than old weather", () => {
  assert.equal(sweepAt(SCANS, step(15) + MAX_AGE_S + 1, false), null);
  assert.equal(sweepAt(SCANS, step(-1), false), null);
});

test("the live step shows the newest sweep, whatever its stamp", () => {
  // A site files a cycle whole, minutes after the composite's step.
  assert.equal(sweepAt(SCANS, step(10), true)?.path, "p15");
});

test("a tilt is kept across a change of quantity, else the lowest is taken", () => {
  const tilts = [{ elevation_deg: 0.5, scans: [] }, { elevation_deg: 1.5, scans: [] }, { elevation_deg: 2.5, scans: [] }];
  assert.equal(tiltNear(tilts, 1.49)?.elevation_deg, 1.5);
  assert.equal(tiltNear(tilts, 8.0)?.elevation_deg, 0.5);
  assert.equal(tiltNear([], 0.5), null);
});

test("the sweeps fetched ahead are the next scanned, wrapping round", () => {
  assert.deepEqual(aheadOf(SCANS, SCANS[1]).map((scan) => scan.path), ["p10", "p15", "p0"]);
  assert.deepEqual(aheadOf(SCANS, null, 2).map((scan) => scan.path), ["p0", "p5"]);
});

const t = (key: string, options?: { values?: Record<string, string | number> }) => (
  options?.values ? `${key}(${Object.entries(options.values).map(([k, v]) => `${k}=${v}`).join(",")})` : key
);

test("a reading says the value and where the bin is", () => {
  const bin = { azimuthDeg: 231.4, groundM: 84_250, heightM: 1_920 };
  assert.deepEqual(describeReading({ kind: "value", value: -12.5 }, "velocity", bin, t), {
    value: "site.read.toward(value=12.5)",
    where: "site.read.where(azimuth=231,range=84.3,height=1.9)",
  });
  assert.equal(describeReading({ kind: "value", value: 31 }, "reflectivity", bin, t).value, "site.read.dbz(value=31.0)");
  assert.equal(describeReading({ kind: "unresolved" }, "srv", bin, t).value, "site.read.unresolved");
});

test("the velocity palette is green toward, red away, grey when still, and marks the reserved bytes", () => {
  const table = velocityTable();
  assert.equal(table.length, 256);
  assert.deepEqual(table[0], [0, 0, 0, 0]);
  assert.deepEqual(table[1], VELOCITY_NO_ECHO);
  assert.deepEqual(table[255], VELOCITY_UNRESOLVED);
  assert.deepEqual(table[128], VELOCITY_CALM);
  const toward = table[108]; // -10 m/s
  const away = table[148]; // +10 m/s
  assert.ok(toward[1] > toward[0], "toward is green");
  assert.ok(away[0] > away[1], "away is red");
});

test("a storm's motion is its newest step's, in metres per second", () => {
  const selection = {
    id: null, summary: null, detail: null, volume: null,
    cell: { series: [{ speed_kmh: 36, heading_deg: 70 }] },
  } as unknown as Parameters<typeof motionOf>[0];
  assert.deepEqual(motionOf(selection), { speedMs: 10, headingDeg: 70 });
  assert.equal(motionOf({ ...selection, cell: null }), null);
});
