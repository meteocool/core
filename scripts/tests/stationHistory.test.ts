import assert from "node:assert/strict";
import test from "node:test";
import { askSince, historyPanels, historyTicks, windowStart } from "../../src/lib/stationHistory.ts";
import type { ObservationRow } from "../../src/lib/stationHistory.ts";
import { fixedScale, path } from "../../src/lib/chartScale.ts";

const row = (minutes: number, values: Partial<ObservationRow>): ObservationRow => ({
  observed_at: new Date(Date.UTC(2026, 9, 27, 0, minutes)).toISOString(),
  ...values,
});

const panel = (rows: ObservationRow[], key: string) => historyPanels(rows).find((one) => one.key === key);
const stat = (rows: ObservationRow[], key: string, which: string) => panel(rows, key)?.stats.find((one) => one.key === which)?.value;

test("no rows, no panels", () => {
  assert.deepEqual(historyPanels([]), []);
});

test("a station with wind alone has the wind's panels and no others", () => {
  const rows = [row(10, { wind_speed_m_s: 2, wind_direction_deg: 220, gust_m_s: 4 })];
  assert.deepEqual(historyPanels(rows).map((one) => one.key), ["wind", "direction"]);
});

test("the panels stack temperature, rain, sun, humidity, pressure, wind, direction", () => {
  const rows = [row(10, {
    temperature_c: 10, precipitation_mm: 0, sunshine_minutes: 0, humidity_pct: 80,
    pressure_msl_hpa: 1015, wind_speed_m_s: 2, wind_direction_deg: 90,
  })];
  assert.deepEqual(historyPanels(rows).map((one) => one.key),
    ["temperature", "precipitation", "sunshine", "humidity", "pressure", "wind", "direction"]);
});

test("the temperature's extremes come from DWD's ten-minute extremes, which catch a peak between readings", () => {
  const rows = [
    row(10, { temperature_c: 10, temperature_max_c: 10.4, temperature_min_c: 9.8 }),
    row(20, { temperature_c: 12, temperature_max_c: 12.6, temperature_min_c: 11.9 }),
  ];
  assert.equal(stat(rows, "temperature", "max"), 12.6);
  assert.equal(stat(rows, "temperature", "min"), 9.8);
  assert.equal(stat(rows, "temperature", "mean"), 11);
});

test("without those extremes, the readings' own", () => {
  const rows = [row(10, { temperature_c: 10 }), row(20, { temperature_c: 12 })];
  assert.equal(stat(rows, "temperature", "max"), 12);
  assert.equal(stat(rows, "temperature", "min"), 10);
});

test("a dry week keeps its rain panel, with nothing fallen", () => {
  const rows = [row(10, { precipitation_mm: 0 }), row(20, { precipitation_mm: 0 })];
  assert.equal(stat(rows, "precipitation", "total"), 0);
});

test("the rain is summed, and the sunshine summed in hours", () => {
  const rows = [
    row(10, { precipitation_mm: 0.3, sunshine_minutes: 10 }),
    row(20, { precipitation_mm: 1.2, sunshine_minutes: 8 }),
    row(30, { precipitation_mm: null, sunshine_minutes: 12 }),
  ];
  assert.ok(Math.abs(stat(rows, "precipitation", "total")! - 1.5) < 1e-9);
  assert.equal(stat(rows, "sunshine", "total"), 0.5);
});

test("the pressure's change is the newest reading less the oldest", () => {
  const rows = [row(10, { pressure_msl_hpa: 1016 }), row(20, { pressure_msl_hpa: null }), row(30, { pressure_msl_hpa: 1013.5 })];
  assert.equal(stat(rows, "pressure", "change"), -2.5);
});

test("the wind's summary is its strongest gust and its mean", () => {
  const rows = [row(10, { wind_speed_m_s: 2, gust_m_s: 5 }), row(20, { wind_speed_m_s: 4, gust_m_s: 9.1 })];
  assert.equal(stat(rows, "wind", "gust"), 9.1);
  assert.equal(stat(rows, "wind", "mean"), 3);
});

test("a window starts its hours before now", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  assert.equal(windowStart("day", now), Date.UTC(2026, 9, 27, 12));
  assert.equal(windowStart("week", now), Date.UTC(2026, 9, 21, 12));
});

test("a line is lifted across a gap longer than the one allowed, and drawn across a shorter one", () => {
  const scale = fixedScale(0, 10, [0, 10], 10, 0);
  const at = (t: number) => t;
  const points = [{ t: 0, v: 1 }, { t: 10, v: 2 }, { t: 100, v: 3 }];
  assert.equal(path(points, at, scale, 40), "M0.0,9.0L10.0,8.0M100.0,7.0");
  assert.equal(path(points, at, scale), "M0.0,9.0L10.0,8.0L100.0,7.0");
});

test("over a day the axis is every six hours on the local clock; over a week, the midnights", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    const to = Date.UTC(2026, 9, 28, 2, 0);
    const day = historyTicks(to - 24 * 3_600_000, to, "en");
    assert.deepEqual(day.map((tick) => tick.label), ["06:00", "12:00", "18:00", "00:00"]);
    const week = historyTicks(to - 7 * 24 * 3_600_000, to, "en");
    assert.equal(week.length, 7);
    assert.equal(week[week.length - 1].label, "Wed");
  } finally {
    process.env.TZ = previous;
  }
});

test("a week's rows are asked for from inside the seven days the service holds", () => {
  const now = Date.UTC(2026, 9, 28, 12);
  const week = 7 * 24 * 3_600_000;
  assert.ok(now - askSince("week", now) < week);
  // Not so far in that the axis would start before the first row by more than one.
  assert.ok(askSince("week", now) - windowStart("week", now) < 10 * 60_000);
});
