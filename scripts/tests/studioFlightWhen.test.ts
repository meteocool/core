import assert from "node:assert/strict";
import { test } from "node:test";
import { boardingUrl, momentOn, readBoarding, whenOf } from "../../src/lib/studio/flight/when.ts";

const coverage = { since: Date.parse("2026-11-09T00:00Z") / 1000, until: Date.parse("2026-11-25T10:20Z") / 1000 };
/** A UTC reader's clock, for the tests to be the same anywhere. */
const clock = (day: number, minute: number) => day / 1000 + minute * 60;
const day = (iso: string) => Date.parse(`${iso}T00:00Z`);

test("a flight is the recorded storm's on its weather, a past window's step in one, and else the radar's now", () => {
  assert.deepEqual(whenOf(true, null, null), { kind: "storm" });
  assert.deepEqual(whenOf(false, { start: 0, end: 7200 }, 7200), { kind: "past", at: 7200 });
  assert.deepEqual(whenOf(false, null, null), { kind: "now" });
});

test("a moment picked is on the five-minute grid, inside what the archive keeps", () => {
  assert.equal(momentOn(day("2026-11-20"), 16 * 60 + 2, coverage, clock), Date.parse("2026-11-20T16:00Z") / 1000);
  assert.equal(momentOn(day("2026-11-20"), 16 * 60 + 3, coverage, clock), Date.parse("2026-11-20T16:05Z") / 1000);
  // Later today than the archive has yet: its newest step.
  assert.equal(momentOn(day("2026-11-25"), 16 * 60, coverage, clock), coverage.until);
  assert.equal(momentOn(day("2026-11-01"), 16 * 60, coverage, clock), coverage.since);
  assert.equal(momentOn(day("2026-11-20"), 16 * 60, null, clock), null);
});

test("the page loaded again goes on to the plan, at the moment asked for where there is one", () => {
  const at = Date.parse("2026-11-20T16:05Z") / 1000;
  const url = boardingUrl("https://meteocool.com/meteoair.html?weather=demo&lang=de", "live", at);
  assert.equal(url, "https://meteocool.com/meteoair.html?weather=live&lang=de&board=2026-11-20T16%3A05Z");
  assert.deepEqual(readBoarding(new URL(url).search), { at });
  assert.deepEqual(readBoarding(new URL(boardingUrl("https://meteocool.com/meteoair.html", "demo", null)).search), { at: null });
  assert.equal(readBoarding("?weather=demo"), null);
});

test("a past window on the history's storm, ending on its moment, is the recorded storm; any other moment is a past one", () => {
  const storm = { at: 7200, lon: 4.3, lat: 44.3 };
  assert.deepEqual(whenOf(false, { start: 0, end: 7200 }, 7200, storm), { kind: "storm" });
  assert.deepEqual(whenOf(false, { start: 300, end: 7500 }, 7500, storm), { kind: "past", at: 7500 });
  assert.deepEqual(whenOf(false, null, null, storm), { kind: "now" });
});
