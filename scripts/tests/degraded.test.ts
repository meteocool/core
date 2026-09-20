import assert from "node:assert/strict";
import test from "node:test";
import {
  DEGRADED_CRITERIA, DEGRADED_TTL_MS, EMPTY_SIGNALS, PUBLISH_OVERDUE_S,
  SLOW_MIN_SAMPLES, SLOW_P95_MS, evaluateDegraded, type DegradedSignals,
} from "../../src/lib/degraded.ts";
import { EMPTY_HEALTH, nextHealth } from "../../src/lib/apiHealth.ts";

/**
 * What puts the map in its degraded state, and -- the half that actually goes
 * wrong -- what takes it back out. A warning that cannot clear itself trains
 * people to ignore the pill, so every criterion here is tested in both
 * directions from the same starting point.
 */

const signals = (over: Partial<DegradedSignals>): DegradedSignals => (
  { ...EMPTY_SIGNALS, ...over }
);

const ids = (s: DegradedSignals, now = 0) => evaluateDegraded(s, now).reasons.map((r) => r.id);

test("a healthy session is not degraded", () => {
  const state = evaluateDegraded(EMPTY_SIGNALS, 0);
  assert.equal(state.degraded, false);
  assert.deepEqual(state.reasons, []);
});

test("every criterion carries the id the panel prints it under", () => {
  // The panel renders DEGRADED_CRITERIA directly, so a criterion without a
  // label or a stable id would show up as a blank row.
  for (const criterion of DEGRADED_CRITERIA) {
    assert.ok(criterion.id, "criterion needs an id");
    assert.ok(criterion.label, `${criterion.id} needs a label`);
  }
  const unique = new Set(DEGRADED_CRITERIA.map((c) => c.id));
  assert.equal(unique.size, DEGRADED_CRITERIA.length, "ids must be unique");
});

test("a failing endpoint degrades, and the next success clears it", () => {
  const failed = nextHealth(EMPTY_HEALTH, "/v3/radar/timeseries", new Error("500"), 1000);
  assert.deepEqual(ids(signals({ health: failed }), 1000), ["api-errors"]);
  const recovered = nextHealth(failed, "/v3/radar/timeseries");
  assert.deepEqual(ids(signals({ health: recovered }), 1000), []);
});

test("a failure nothing is retrying ages out without anything clearing it", () => {
  const failed = nextHealth(EMPTY_HEALTH, "/v3/lightning/stats", new Error("500"), 1000);
  assert.deepEqual(ids(signals({ health: failed }), 1000 + DEGRADED_TTL_MS - 1), ["api-errors"]);
  assert.deepEqual(ids(signals({ health: failed }), 1000 + DEGRADED_TTL_MS), []);
});

test("a slow p95 degrades only once there are enough responses behind it", () => {
  const slow = { recentP95Ms: SLOW_P95_MS + 1 };
  assert.deepEqual(ids(signals({ ...slow, recentSamples: SLOW_MIN_SAMPLES - 1 })), []);
  assert.deepEqual(
    ids(signals({ ...slow, recentSamples: SLOW_MIN_SAMPLES })),
    ["slow-responses"],
  );
});

test("latency recovers on its own as the window fills with fast responses", () => {
  const before = signals({ recentP95Ms: SLOW_P95_MS + 500, recentSamples: 20 });
  assert.deepEqual(ids(before), ["slow-responses"]);
  // Nothing reset: the window simply moved on.
  const after = signals({ recentP95Ms: 250, recentSamples: 20 });
  assert.deepEqual(ids(after), []);
});

test("a p95 exactly on the threshold counts, one below it does not", () => {
  const at = signals({ recentP95Ms: SLOW_P95_MS, recentSamples: 30 });
  const under = signals({ recentP95Ms: SLOW_P95_MS - 1, recentSamples: 30 });
  assert.deepEqual(ids(at), ["slow-responses"]);
  assert.deepEqual(ids(under), []);
});

test("a backend that has stopped publishing degrades, and one frame clears it", () => {
  assert.deepEqual(ids(signals({ publishOverdueS: PUBLISH_OVERDUE_S })), ["stale-publish"]);
  // Slipping by less than a whole extra cycle is jitter, not an incident.
  assert.deepEqual(ids(signals({ publishOverdueS: PUBLISH_OVERDUE_S - 1 })), []);
  // Negative means the next one is not even due yet.
  assert.deepEqual(ids(signals({ publishOverdueS: -120 })), []);
});

test("no cadence learned yet is never a reason on its own", () => {
  // A cold session must not accuse a backend it has not watched publish.
  assert.deepEqual(ids(signals({ publishOverdueS: null })), []);
});

test("several criteria are reported together, and clear independently", () => {
  const failed = nextHealth(EMPTY_HEALTH, "/a", new Error("500"), 1000);
  const both = signals({
    health: failed,
    recentP95Ms: SLOW_P95_MS + 1,
    recentSamples: SLOW_MIN_SAMPLES,
    publishOverdueS: PUBLISH_OVERDUE_S,
  });
  assert.deepEqual(ids(both, 1000), ["api-errors", "slow-responses", "stale-publish"]);
  const recovered = evaluateDegraded(
    { ...both, health: nextHealth(failed, "/a"), recentP95Ms: 100 },
    1000,
  );
  assert.deepEqual(recovered.reasons.map((r) => r.id), ["stale-publish"]);
  assert.equal(recovered.degraded, true);
});

test("every reason says something a person can act on", () => {
  const state = evaluateDegraded(signals({
    health: nextHealth(EMPTY_HEALTH, "/v3/radar/timeseries", new Error("500"), 1000),
    recentP95Ms: 9000,
    recentSamples: 40,
    publishOverdueS: 900,
  }), 1000);
  for (const reason of state.reasons) {
    assert.ok(reason.detail.length > 0, `${reason.id} reported an empty detail`);
  }
  assert.match(state.reasons[0].detail, /\/v3\/radar\/timeseries/);
});
