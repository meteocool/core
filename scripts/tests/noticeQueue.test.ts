import assert from "node:assert/strict";
import test from "node:test";
import { dismissalKey, nextNotice, ranked, rearmed, type Candidates } from "../../src/lib/noticeQueue.ts";

/**
 * The one notice the player shows: a fixed order, and a dismissed one
 * yielding to the next.
 */

const NONE: Candidates = {
  ours: [], noCoverage: false, radarStopped: false, forecastStopped: false, noForecast: false, dryOutlook: false,
};
const warning = { id: "pl-service", level: "warning" as const, text: "Poland's radars are being serviced." };
const info = { id: "hello", level: "info" as const, text: "Hello." };
const EVERYTHING: Candidates = {
  ours: [warning, info], noCoverage: true, radarStopped: true, forecastStopped: true, noForecast: true, dryOutlook: true,
};

const kinds = (candidates: Candidates) => ranked(candidates).map((notice) => (
  notice.kind === "ours" ? notice.notice.id : notice.kind
));

test("nothing applies, nothing is shown", () => {
  assert.equal(nextNotice(NONE, new Set()), null);
});

test("ours come first, then coverage, the radar, the forecast and the dry outlook", () => {
  assert.deepEqual(kinds(EVERYTHING), ["pl-service", "hello", "no-coverage", "radar-stopped", "forecast-stopped", "dry-outlook"]);
});

test("no forecast here comes after the feeds and before the dry outlook", () => {
  assert.deepEqual(kinds({ ...NONE, noForecast: true, dryOutlook: true }), ["no-forecast", "dry-outlook"]);
});

test("no forecast here is not said while the radar's feed is the reason", () => {
  assert.deepEqual(kinds({ ...NONE, radarStopped: true, noForecast: true }), ["radar-stopped"]);
});

test("no forecast here is not said while the forecast's feed is the reason", () => {
  assert.deepEqual(kinds({ ...NONE, forecastStopped: true, noForecast: true }), ["forecast-stopped"]);
});

test("the dry outlook cannot stand under the radar's notice", () => {
  const shown = nextNotice({ ...NONE, radarStopped: true, dryOutlook: true }, new Set());
  assert.equal(shown?.kind, "radar-stopped");
});

test("only the first is shown", () => {
  const shown = nextNotice(EVERYTHING, new Set());
  assert.equal(shown?.kind === "ours" && shown.notice.id, "pl-service");
});

test("a dismissed notice yields to the next", () => {
  const dismissed = new Set([dismissalKey({ kind: "ours", notice: warning }), "no-coverage"]);
  const shown = nextNotice({ ...EVERYTHING, ours: [warning] }, dismissed);
  assert.equal(shown?.kind, "radar-stopped");
});

test("the radar's notice dismissed, the forecast's still yields to nothing wrong", () => {
  // Dismissing "not coming in" does not make "No Forecast Here" the reason.
  const shown = nextNotice({ ...NONE, radarStopped: true, noForecast: true }, new Set(["radar-stopped"]));
  assert.equal(shown, null);
});

test("a dismissed condition comes back once it has cleared and returns", () => {
  const dismissed = new Set(["radar-stopped"]);
  assert.deepEqual([...rearmed(dismissed, { ...NONE, radarStopped: true })], ["radar-stopped"]);
  const cleared = rearmed(dismissed, NONE);
  assert.deepEqual([...cleared], []);
  assert.equal(nextNotice({ ...NONE, radarStopped: true }, cleared)?.kind, "radar-stopped");
});

test("a dismissed notice of ours stays dismissed for the session, applying or not", () => {
  const key = dismissalKey({ kind: "ours", notice: warning });
  assert.deepEqual([...rearmed(new Set([key]), NONE)], [key]);
});

test("no forecast here stays dismissed while it applies under the radar's notice", () => {
  const kept = rearmed(new Set(["no-forecast"]), { ...NONE, radarStopped: true, noForecast: true });
  assert.deepEqual([...kept], ["no-forecast"]);
});
