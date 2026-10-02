import assert from "node:assert/strict";
import test from "node:test";
import { apiHealth } from "../../src/stores.ts";
import { EMPTY_HEALTH, nextHealth } from "../../src/lib/apiHealth.ts";
import { onWake } from "../../src/lib/wakeup.ts";
import {
  cleanupRecovery, FIRST_PROBE_MS, initRecovery, noteTransientFailure, PROBE_MS,
} from "../../src/lib/recovery.ts";

/**
 * A failure the network caused is asked again, quietly and one endpoint at a
 * time, until it answers; the first answer resyncs the page, and once
 * nothing is failing nothing is asked.
 */

/** Each test's clock starts well past the last one's: wake() remembers when it last ran. */
let epoch = 0;

function setup(t: test.TestContext) {
  epoch += 10_000_000;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: epoch });
  apiHealth.set(EMPTY_HEALTH);
  initRecovery();
  const wakes: string[] = [];
  const off = onWake((reason) => wakes.push(reason));
  t.after(() => {
    off();
    cleanupRecovery();
    apiHealth.set(EMPTY_HEALTH);
  });
  return wakes;
}

const fail = (id: string) => apiHealth.update((health) => nextHealth(health, id, new Error("stalled")));
const recover = (id: string) => apiHealth.update((health) => nextHealth(health, id));

function failingNow(): string[] {
  let failing: string[] = [];
  apiHealth.subscribe((health) => { failing = health.failing; })();
  return failing;
}

/** A probe that answers once `up` says so, recording the recovery as the real one does. */
function prober(id: string, up: () => boolean) {
  const asked: number[] = [];
  const ask = async () => {
    asked.push(Date.now());
    if (!up()) return false;
    recover(id);
    return true;
  };
  return { ask, asked };
}

/** Lets a probe's promise settle after its timer fires. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function tick(t: test.TestContext, ms: number) {
  t.mock.timers.tick(ms);
  await settle();
}

test("a failure is probed after FIRST_PROBE_MS, then every PROBE_MS, until it answers", async (t) => {
  const wakes = setup(t);
  let up = false;
  const p = prober("/v3/radar/timeseries", () => up);
  fail("/v3/radar/timeseries");
  noteTransientFailure("/v3/radar/timeseries", p.ask);

  await tick(t, FIRST_PROBE_MS - 1);
  assert.equal(p.asked.length, 0);
  await tick(t, 1);
  assert.equal(p.asked.length, 1);
  await tick(t, PROBE_MS);
  assert.equal(p.asked.length, 2);
  assert.equal(wakes.length, 0);

  up = true;
  await tick(t, PROBE_MS);
  assert.equal(p.asked.length, 3);
  assert.equal(wakes.length, 1, "the answer resyncs the page");
  assert.deepEqual(failingNow(), []);

  // Healthy: nothing more is asked.
  await tick(t, PROBE_MS * 5);
  assert.equal(p.asked.length, 3);
});

test("failing endpoints take turns, one probe at a time", async (t) => {
  setup(t);
  const a = prober("/v3/radar/timeseries", () => false);
  const b = prober("/cells/tracks", () => false);
  fail("/v3/radar/timeseries");
  fail("/cells/tracks");
  noteTransientFailure("/v3/radar/timeseries", a.ask);
  noteTransientFailure("/cells/tracks", b.ask);

  await tick(t, FIRST_PROBE_MS);
  await tick(t, PROBE_MS);
  await tick(t, PROBE_MS);
  assert.equal(a.asked.length + b.asked.length, 3);
  assert.ok(a.asked.length >= 1 && b.asked.length >= 1);
});

test("an endpoint that recovers some other way is no longer probed", async (t) => {
  setup(t);
  const p = prober("/lightning_cache", () => false);
  fail("/lightning_cache");
  noteTransientFailure("/lightning_cache", p.ask);
  // A socket poke refetched it in the meantime.
  recover("/lightning_cache");
  await tick(t, FIRST_PROBE_MS + PROBE_MS * 3);
  assert.equal(p.asked.length, 0);
});
