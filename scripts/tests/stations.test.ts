import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STATION_CHOICE, formatValue, parametersFor, parseStationChoice, precipitationDbz, resolutionAt,
  STATION_CHOICES, stationsAt, stationsShown, temperatureColour, thinningCell, thinToGrid, valueOf, windOf,
} from "../../src/lib/stations.ts";
import type { ObservedProperties } from "../../src/lib/stations.ts";

const station = (values: Partial<ObservedProperties>): ObservedProperties => ({
  station: "02290",
  name: "Hohenpeißenberg",
  state: "Bayern",
  elevation_m: 977,
  datasets: [],
  observed_at: "2026-10-11T01:30:00Z",
  ...values,
});

test("the stations are shown when switched on, over the radar map", () => {
  assert.equal(stationsShown(true, "radar"), true);
});

test("switched off, the stations are not shown", () => {
  assert.equal(stationsShown(false, "radar"), false);
});

test("on another map, the stations are not shown even when switched on", () => {
  assert.equal(stationsShown(true, "lightning"), false);
  assert.equal(stationsShown(true, "cells3d"), false);
});

test("wind asks for its speed and direction, and nothing else", () => {
  assert.deepEqual(parametersFor("wind"), ["wind_speed_m_s", "wind_direction_deg"]);
});

test("gusts ask for the gust and its direction", () => {
  assert.deepEqual(parametersFor("gusts"), ["gust_m_s", "gust_direction_deg"]);
});

test("each value choice asks for its one parameter", () => {
  assert.deepEqual(parametersFor("temperature"), ["temperature_c"]);
  assert.deepEqual(parametersFor("precipitation"), ["precipitation_mm"]);
  assert.deepEqual(parametersFor("humidity"), ["humidity_pct"]);
  assert.deepEqual(parametersFor("pressure"), ["pressure_msl_hpa"]);
});

test("the choices are offered wind first, and wind is the default", () => {
  assert.deepEqual(STATION_CHOICES, ["wind", "gusts", "temperature", "precipitation", "humidity", "pressure"]);
  assert.equal(DEFAULT_STATION_CHOICE, "wind");
});

test("a stored choice is read back, and anything else is the default", () => {
  assert.equal(parseStationChoice("humidity"), "humidity");
  assert.equal(parseStationChoice("cloud_cover"), "wind");
  assert.equal(parseStationChoice(null), "wind");
});

const NEWEST = Date.UTC(2026, 9, 11, 1, 35) / 1000;

test("live, the stations asked for are the newest", () => {
  assert.equal(stationsAt(NEWEST, NEWEST), null);
});

test("on an observed frame in the past, the stations asked for are the ones from then", () => {
  assert.deepEqual(stationsAt(NEWEST - 1800, NEWEST), new Date((NEWEST - 1800) * 1000));
});

test("on a forecast frame, the stations asked for are the newest", () => {
  assert.equal(stationsAt(NEWEST + 900, NEWEST), null);
});

test("before the timeline has a grid, the stations asked for are the newest", () => {
  assert.equal(stationsAt(0, 0), null);
  assert.equal(stationsAt(NEWEST - 600, 0), null);
});

test("a barb's wind is in knots, from the gust's own direction for gusts", () => {
  const values = station({ wind_speed_m_s: 5, wind_direction_deg: 280, gust_m_s: 10, gust_direction_deg: 260 });
  const wind = windOf("wind", values)!;
  assert.ok(Math.abs(wind.knots - 9.71922) < 1e-4);
  assert.equal(wind.fromDeg, 280);
  assert.equal(windOf("gusts", values)!.fromDeg, 260);
});

test("a station without a speed or a direction gets no barb", () => {
  assert.equal(windOf("wind", station({ wind_speed_m_s: 3 })), null);
  assert.equal(windOf("gusts", station({ wind_speed_m_s: 3, wind_direction_deg: 90 })), null);
});

test("a value is the choice's own parameter, and missing when the station did not report it", () => {
  assert.equal(valueOf("temperature", station({ temperature_c: 7.3 })), 7.3);
  assert.equal(valueOf("pressure", station({ pressure_hpa: 905 })), null);
  assert.equal(valueOf("wind", station({ wind_speed_m_s: 3 })), null);
});

test("values read with one decimal, humidity in whole percent", () => {
  assert.equal(formatValue("temperature", 7.26), "7.3");
  assert.equal(formatValue("pressure", 1013), "1013.0");
  assert.equal(formatValue("precipitation", 0.04), "0.0");
  assert.equal(formatValue("humidity", 86.6), "87");
});

test("a value rounding to zero is never written negative", () => {
  assert.equal(formatValue("temperature", -0.04), "0.0");
  assert.equal(formatValue("humidity", -0.2), "0");
});

test("temperatures are coloured by band, cold to hot", () => {
  const bands = [-15, -5, 5, 15, 25, 35].map(temperatureColour);
  assert.equal(new Set(bands).size, 6);
  assert.equal(temperatureColour(0), temperatureColour(5));
  assert.equal(temperatureColour(-0.1), temperatureColour(-5));
});

test("rain is coloured at the reflectivity its rate would show, and none has no colour", () => {
  assert.equal(precipitationDbz(0), null);
  // A trace written 0.0 is drawn as a dry gauge.
  assert.equal(precipitationDbz(0.04), null);
  // 0.1 mm in ten minutes is 0.6 mm/h: about 20 dBZ.
  assert.ok(Math.abs(precipitationDbz(0.1)! - 19.46) < 0.05);
  assert.ok(precipitationDbz(2)! > precipitationDbz(0.5)!);
});

test("a zoom's resolution halves with every step in", () => {
  assert.ok(Math.abs(resolutionAt(0) - 156543.034) < 1e-3);
  assert.ok(Math.abs(resolutionAt(8) - 611.496) < 1e-3);
  assert.equal(resolutionAt(9), resolutionAt(8) / 2);
});

test("from zoom 8 in every station is shown; further out they are thinned", () => {
  assert.equal(thinningCell(8), 0);
  assert.equal(thinningCell(11), 0);
  assert.ok(thinningCell(6) > 0);
  assert.ok(thinningCell(7.9) > 0);
});

test("thinning leaves one station per cell, the one nearest its middle", () => {
  const kept = thinToGrid([
    { id: "corner", x: 2, y: 2, rank: 0 },
    { id: "middle", x: 21, y: 23, rank: 0 },
    { id: "next", x: 60, y: 20, rank: 0 },
  ], 44);
  assert.deepEqual([...kept].sort(), ["middle", "next"]);
});

test("thinning keeps the higher ranked station of a cell, wherever it is in it", () => {
  const kept = thinToGrid([
    { id: "dry", x: 22, y: 22, rank: 0 },
    { id: "wet", x: 3, y: 40, rank: 0.4 },
  ], 44);
  assert.deepEqual([...kept], ["wet"]);
});

test("with no cell, thinning keeps every station", () => {
  const stations = [{ id: "a", x: 1, y: 1, rank: 0 }, { id: "b", x: 2, y: 2, rank: 0 }];
  assert.equal(thinToGrid(stations, 0).size, 2);
});
