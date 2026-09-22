import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_HEALTH, markAbsent, nextHealth } from "../../src/lib/apiHealth.ts";

/**
 * The bookkeeping behind the "Degraded" pill: which endpoints are currently
 * failing, and what a session has seen fail since it loaded. Whether any of it
 * is worth a warning is degraded.test.ts's question.
 *
 * Getting `failing` wrong is bad in a way nothing else catches: a route that
 * never leaves it trains people to ignore the pill, and one that leaves too
 * eagerly hides a backend that is still down.
 */

test("a healthy session reports nothing", () => {
  assert.deepEqual(EMPTY_HEALTH.failing, []);
  assert.equal(EMPTY_HEALTH.failures, 0);
});

test("a success on an endpoint that was never failing changes nothing", () => {
  const after = nextHealth(EMPTY_HEALTH, "/v3/radar/timeseries");
  // Same object, so no subscriber is woken for a non-event.
  assert.equal(after, EMPTY_HEALTH);
});

test("a failure counts, names the endpoint and marks it failing", () => {
  const after = nextHealth(EMPTY_HEALTH, "/v3/lightning/stats", new Error("boom"), 1000);
  assert.equal(after.failures, 1);
  assert.deepEqual(after.byEndpoint, { "/v3/lightning/stats": 1 });
  assert.deepEqual(after.failing, ["/v3/lightning/stats"]);
  assert.equal(after.lastFailureAt, 1000);
  assert.equal(after.lastMessage, "boom");
});

test("repeated failures on one endpoint count but list it once", () => {
  let health = nextHealth(EMPTY_HEALTH, "/a", new Error("1"), 1);
  health = nextHealth(health, "/a", new Error("2"), 2);
  health = nextHealth(health, "/a", new Error("3"), 3);
  assert.equal(health.failures, 3);
  assert.deepEqual(health.byEndpoint, { "/a": 3 });
  assert.deepEqual(health.failing, ["/a"]);
  assert.equal(health.lastMessage, "3");
});

test("the next success on that endpoint clears the warning", () => {
  const failed = nextHealth(EMPTY_HEALTH, "/a", new Error("boom"), 1);
  const recovered = nextHealth(failed, "/a");
  assert.deepEqual(recovered.failing, []);
  // The history stays: the diagnostics still have something to show.
  assert.equal(recovered.failures, 1);
  assert.deepEqual(recovered.byEndpoint, { "/a": 1 });
});

test("a success elsewhere does not clear a route that is still down", () => {
  const failed = nextHealth(EMPTY_HEALTH, "/a", new Error("boom"), 1);
  const other = nextHealth(failed, "/b");
  assert.deepEqual(other.failing, ["/a"]);
});

test("two broken endpoints are both listed, and clear independently", () => {
  let health = nextHealth(EMPTY_HEALTH, "/a", new Error("a"), 1);
  health = nextHealth(health, "/b", new Error("b"), 2);
  assert.deepEqual(health.failing, ["/a", "/b"]);
  health = nextHealth(health, "/a");
  assert.deepEqual(health.failing, ["/b"]);
  health = nextHealth(health, "/b");
  assert.deepEqual(health.failing, []);
  assert.equal(health.failures, 2);
});

test("a non-Error rejection still leaves a readable message", () => {
  const after = nextHealth(EMPTY_HEALTH, "/a", "Internal Server Error", 1);
  assert.equal(after.lastMessage, "Internal Server Error");
});

test("the previous state is never mutated", () => {
  const before = nextHealth(EMPTY_HEALTH, "/a", new Error("boom"), 1);
  const snapshot = JSON.parse(JSON.stringify(before));
  nextHealth(before, "/a", new Error("again"), 2);
  nextHealth(before, "/a");
  assert.deepEqual(JSON.parse(JSON.stringify(before)), snapshot);
});

/*
 * Absence, which is a different claim from failure.
 *
 * Some of what the map draws is published on a timer of its own and answers
 * 404 until its first capture lands. Counted as a failed call it put the map
 * in its degraded state and raised "Something went wrong" over a layer working
 * exactly as designed -- on a backend with no Swiss capture at all, for the
 * whole session. So it is recorded, and recorded where the degraded criteria
 * do not look.
 */

test("an absence is not a failure", () => {
  const after = markAbsent(EMPTY_HEALTH, "/v3/radar/switzerland");
  assert.deepEqual(after.absent, ["/v3/radar/switzerland"]);
  assert.deepEqual(after.failing, []);
  assert.equal(after.failures, 0);
  assert.equal(after.lastFailureAt, null);
});

test("an endpoint that keeps finding nothing is recorded once", () => {
  let health = markAbsent(EMPTY_HEALTH, "/a");
  health = markAbsent(health, "/a");
  assert.deepEqual(health.absent, ["/a"]);
  assert.equal(health, markAbsent(health, "/a"));
});

test("a published answer clears the absence", () => {
  const absent = markAbsent(EMPTY_HEALTH, "/a");
  assert.deepEqual(nextHealth(absent, "/a").absent, []);
});

test("an endpoint that starts erroring is no longer merely empty", () => {
  const absent = markAbsent(EMPTY_HEALTH, "/a");
  const broken = nextHealth(absent, "/a", new Error("boom"), 1);
  assert.deepEqual(broken.absent, []);
  assert.deepEqual(broken.failing, ["/a"]);
});

test("an endpoint that stops erroring and starts answering nothing swaps sides", () => {
  const broken = nextHealth(EMPTY_HEALTH, "/a", new Error("boom"), 1);
  const empty = markAbsent(broken, "/a");
  assert.deepEqual(empty.failing, []);
  assert.deepEqual(empty.absent, ["/a"]);
  // The history of the outage is kept; it is the live fault that has cleared.
  assert.equal(empty.failures, 1);
});

test("an absence does not mutate what it was given", () => {
  const before = nextHealth(EMPTY_HEALTH, "/a", new Error("boom"), 1);
  const snapshot = JSON.parse(JSON.stringify(before));
  markAbsent(before, "/a");
  markAbsent(before, "/b");
  assert.deepEqual(JSON.parse(JSON.stringify(before)), snapshot);
});
