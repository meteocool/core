import assert from "node:assert/strict";
import test from "node:test";
import {
  CATCH_UP_MAX_MS, CATCH_UP_MIN_MS, INITIAL_CONNECTION, nextConnection, nextDeadline,
  type Connection, type ConnectionSignals, type ConnectionState,
} from "../../src/lib/connectionState.ts";
import {
  REACHABLE, answered, finished, started, unanswered,
} from "../../src/lib/reachability.ts";

/**
 * The connection's state machine: offline, degraded, and the catching up in
 * between either of them and online. Every way in is tested with its way out,
 * since a state that cannot leave is the bug that matters here.
 */

const HEALTHY: ConnectionSignals = {
  browserOnline: true, unreachable: false, degraded: false, inFlight: 0, stale: false,
};
const signals = (over: Partial<ConnectionSignals> = {}): ConnectionSignals => ({ ...HEALTHY, ...over });
const at = (state: ConnectionState, since = 0): Connection => ({ state, since });

/** Steps the machine through `(signals, time)` pairs, returning the states it passed through. */
function run(steps: Array<[Partial<ConnectionSignals>, number]>, from: Connection = INITIAL_CONNECTION): ConnectionState[] {
  let current = from;
  return steps.map(([over, now]) => {
    current = nextConnection(current, signals(over), now);
    return current.state;
  });
}

test("a healthy session stays online, and the same object comes back", () => {
  const current = at("online");
  assert.equal(nextConnection(current, HEALTHY, 1000), current);
});

test("cut off is offline from every state", () => {
  for (const state of ["online", "degraded", "catching-up", "offline"] as const) {
    assert.equal(nextConnection(at(state), signals({ browserOnline: false }), 10).state, "offline");
    assert.equal(nextConnection(at(state), signals({ unreachable: true }), 10).state, "offline");
  }
});

test("offline outranks degraded: an outage fails every call as well", () => {
  assert.equal(nextConnection(at("online"), signals({ unreachable: true, degraded: true }), 0).state, "offline");
});

test("back from offline catches up, then settles online once the refetch lands", () => {
  const states = run([
    [{ unreachable: true, degraded: true }, 0],
    // Answered again: the endpoints that failed meanwhile are still failing,
    // which is not degraded but what the refetch is for.
    [{ degraded: true, inFlight: 4 }, 10_000],
    // Past the minimum, still fetching.
    [{ degraded: true, inFlight: 2 }, 10_000 + CATCH_UP_MIN_MS],
    [{ inFlight: 0 }, 13_000],
  ]);
  assert.deepEqual(states, ["offline", "catching-up", "catching-up", "online"]);
});

test("catching up holds for its minimum even when the refetch has not started", () => {
  // A recovered probe marks its endpoint healthy a moment before the wake's
  // refetch goes out; judged in that moment, nothing is in flight.
  const catching = at("catching-up", 1000);
  assert.equal(nextConnection(catching, HEALTHY, 1000 + CATCH_UP_MIN_MS - 1), catching);
  assert.equal(nextConnection(catching, HEALTHY, 1000 + CATCH_UP_MIN_MS).state, "online");
});

test("catching up waits for the radar to be current again, too", () => {
  const catching = at("catching-up", 0);
  assert.equal(nextConnection(catching, signals({ stale: true }), CATCH_UP_MIN_MS).state, "catching-up");
  assert.equal(nextConnection(catching, signals(), CATCH_UP_MIN_MS + 1).state, "online");
});

test("catching up gives up at its maximum, on a call that never settles", () => {
  const catching = at("catching-up", 0);
  assert.equal(nextConnection(catching, signals({ inFlight: 1 }), CATCH_UP_MAX_MS - 1).state, "catching-up");
  assert.equal(nextConnection(catching, signals({ inFlight: 1 }), CATCH_UP_MAX_MS).state, "online");
});

test("caught up with the backend still misbehaving is degraded", () => {
  assert.equal(nextConnection(at("catching-up", 0), signals({ degraded: true }), CATCH_UP_MIN_MS).state, "degraded");
});

test("degraded comes and goes by way of catching up", () => {
  const states = run([
    [{ degraded: true }, 0],
    [{ degraded: true }, 5000],
    [{ inFlight: 3 }, 10_000],
    [{}, 10_000 + CATCH_UP_MIN_MS],
  ]);
  assert.deepEqual(states, ["degraded", "degraded", "catching-up", "online"]);
});

test("unreachable while catching up goes back to offline", () => {
  assert.equal(nextConnection(at("catching-up", 0), signals({ unreachable: true }), 100).state, "offline");
});

test("only catching up has a deadline: its minimum, then its maximum", () => {
  assert.equal(nextDeadline(at("online"), 0), null);
  assert.equal(nextDeadline(at("offline"), 0), null);
  assert.equal(nextDeadline(at("degraded"), 0), null);
  assert.equal(nextDeadline(at("catching-up", 100), 100), 100 + CATCH_UP_MIN_MS);
  assert.equal(nextDeadline(at("catching-up", 100), 100 + CATCH_UP_MIN_MS), 100 + CATCH_UP_MAX_MS);
});

test("a call with no answer and nothing answered since is unreachable", () => {
  const r = unanswered(answered(REACHABLE, 1000), 2000, 8000);
  assert.equal(r.unreachableSince, 8000);
  // A cold start that never reached the backend at all is unreachable too.
  assert.equal(unanswered(REACHABLE, 0, 5000).unreachableSince, 5000);
});

test("a call lost while others were answered is not unreachable", () => {
  // Sent at 2000; something else came back at 3000; this one stalled out at 8000.
  const r = unanswered(answered(REACHABLE, 3000), 2000, 8000);
  assert.equal(r.unreachableSince, null);
});

test("the first answer clears unreachable, and a later miss keeps its start", () => {
  let r = unanswered(REACHABLE, 0, 5000);
  r = unanswered(r, 6000, 9000);
  assert.equal(r.unreachableSince, 5000);
  r = answered(r, 12_000);
  assert.equal(r.unreachableSince, null);
  assert.equal(r.lastAnswerAt, 12_000);
});

test("calls in flight are counted up and down, never below zero", () => {
  let r = started(started(REACHABLE));
  assert.equal(r.inFlight, 2);
  r = finished(finished(finished(r)));
  assert.equal(r.inFlight, 0);
});
