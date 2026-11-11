import assert from "node:assert/strict";
import test from "node:test";
import { STALLED_BEHIND_S, saysFeedStopped, stalledNetworks } from "../../src/lib/feedOutage.ts";

/**
 * Which countries' radar has stopped arriving, measured against DWD's, and
 * when the player says so in place of "No Forecast Here".
 */

const HX = 1_794_430_200;

test("a network level with DWD is live", () => {
  assert.deepEqual(stalledNetworks([{ code: "fr", newestScan: HX - 120, answered: true }], HX), []);
});

test("a network three cycles behind DWD is still live, one more and it has stopped", () => {
  const feeds = [
    { code: "fr" as const, newestScan: HX - STALLED_BEHIND_S, answered: true },
    { code: "pl" as const, newestScan: HX - STALLED_BEHIND_S - 60, answered: true },
  ];
  assert.deepEqual(stalledNetworks(feeds, HX), ["pl"]);
});

test("a network with no fresh frame at all has stopped once the backend has answered for it", () => {
  // 2026-11-11: EUMETNET's bucket stopped at 20:16, and every country's frame aged out.
  assert.deepEqual(stalledNetworks([{ code: "se", newestScan: null, answered: true }], HX), ["se"]);
});

test("a network not yet heard from is not an outage", () => {
  assert.deepEqual(stalledNetworks([{ code: "se", newestScan: null, answered: false }], HX), []);
});

test("nothing is stalled while DWD's own scan is unknown", () => {
  assert.deepEqual(stalledNetworks([{ code: "se", newestScan: null, answered: true }], null), []);
});

test("in place of 'no forecast' wherever a stalled network is on screen", () => {
  assert.equal(saysFeedStopped(0.1, true), true);
});

test("otherwise only when stalled networks hold half the screen", () => {
  assert.equal(saysFeedStopped(0.1, false), false);
  assert.equal(saysFeedStopped(0.5, false), true);
});

test("never without a stalled network on screen", () => {
  assert.equal(saysFeedStopped(0, true), false);
});
