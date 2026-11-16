import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import {
  GROUPS_ABSENT, GROUPS_RECHECK_MS, asksForGroups, groupOutlines, groupShownAt, systemSize,
} from "../../src/lib/stormGroups.ts";
import { fetchStormGroups, NothingPublished } from "../../src/api/index.ts";
import { apiHealth } from "../../src/stores.ts";
import { T0, at, group, sid, storm } from "./stormFixtures.ts";

/**
 * Storms that are one system: which groups the map outlines, how many storms
 * a storm's panel says its system has, and what a backend without groups
 * comes to.
 */

const A = sid("A");
const B = sid("B");
const C = sid("C");
const G = "01JGROUPGROUPGROUPGROUPGRP";

test("a group of two storms is one outline, its polygons in [lon, lat]", () => {
  const [outline] = groupOutlines([group(G, [A, B], { severity: 2 })], T0);
  assert.equal(outline.id, G);
  assert.equal(outline.storms, 2);
  assert.equal(outline.severity, 2);
  assert.equal(outline.polygons.length, 1);
  assert.deepEqual(outline.polygons[0][0][0], [9.9, 49.9]);
});

test("every polygon of a group's MultiPolygon is kept, holes and all", () => {
  const two = group(G, [A, B]);
  const hole = [[10, 50], [10.01, 50], [10.01, 50.01], [10, 50]];
  const far = [[11, 51], [11.1, 51], [11.1, 51.1], [11, 51]];
  two.geometry.coordinates = [[two.geometry.coordinates[0][0], hole], [far]];
  const [outline] = groupOutlines([two], T0);
  assert.equal(outline.polygons.length, 2);
  assert.equal(outline.polygons[0].length, 2);
});

test("a group of fewer than two storms is not outlined", () => {
  assert.deepEqual(groupOutlines([group(G, [A])], T0), []);
});

test("a group with no area is not outlined, and a broken ring is left out", () => {
  const point = { ...group(G, [A, B]), geometry: { type: "Point", coordinates: [10, 50] } } as never;
  const empty = { ...group(G, [A, B]), geometry: { type: "MultiPolygon", coordinates: [] } } as never;
  const short = { ...group(G, [A, B]), geometry: { type: "MultiPolygon", coordinates: [[[[10, 50], [10.1, 50]]]] } } as never;
  assert.deepEqual(groupOutlines([point, empty, short], T0), []);
});

test("a storm listing served where groups were asked for draws nothing", () => {
  assert.deepEqual(groupOutlines([storm(A), storm(B)] as never, T0), []);
});

test("in the present a group still going is outlined, and one gone for longer than a storm stays active is not", () => {
  assert.equal(groupShownAt(group(G, [A, B], { last_seen: at(-15) }), T0), true);
  assert.equal(groupShownAt(group(G, [A, B], { last_seen: at(-25) }), T0), false);
});

test("on an earlier frame a group is outlined only when born by then and its outline not long after", () => {
  const g = group(G, [A, B], { born_at: at(-90), last_seen: at(0) });
  assert.equal(groupShownAt(g, T0 - 20 * 60_000), true);
  assert.equal(groupShownAt(g, T0 - 60 * 60_000), false, "its outline is an hour on from then");
  assert.equal(groupShownAt(g, T0 - 100 * 60_000), false, "not yet born");
});

test("a storm's system is as many storms as its group lists", () => {
  const of = storm(A, { group: G });
  assert.equal(systemSize(of, [group(G, [B, A, C])], []), 3);
});

test("a storm in no group, or with no group field, has no system", () => {
  assert.equal(systemSize(storm(A), [group(G, [A, B])], []), null);
  assert.equal(systemSize(storm(A, { group: null }), [group(G, [A, B])], []), null);
  assert.equal(systemSize(null, [], []), null);
});

test("without the group's outline, a storm's system is the storms held that share its group", () => {
  const held = [storm(A, { group: G }), storm(B, { group: G }), storm(C, { group: "other" })];
  assert.equal(systemSize(held[0], [], held), 2);
});

test("a group of one is no system", () => {
  const alone = storm(A, { group: G });
  assert.equal(systemSize(alone, [], [alone]), null);
  assert.equal(systemSize(alone, [group(G, [A])], [alone]), null);
});

test("a 404 and a 422 both mean the backend has no groups", () => {
  assert.deepEqual([...GROUPS_ABSENT].sort(), [404, 422]);
});

test("a backend that had no groups is not asked again until the recheck is due", () => {
  assert.equal(asksForGroups(null, T0), true);
  assert.equal(asksForGroups(T0, T0 + 60_000), false);
  assert.equal(asksForGroups(T0, T0 + GROUPS_RECHECK_MS), true);
});

/** A backend that answers every request with `status`, counting them. */
function answering(status: number) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify({ detail: "Not Found" }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const quiet = { start() {}, finish() {} };

for (const status of GROUPS_ABSENT) {
  test(`a ${status} from /storms/groups is no groups: asked once, and not counted as a failure`, async () => {
    const server = answering(status);
    try {
      await assert.rejects(fetchStormGroups([5, 45, 15, 55], 180, quiet), NothingPublished);
      assert.equal(server.calls.length, 1);
      assert.match(server.calls[0], /\/storms\/groups\?/);
      assert.equal(get(apiHealth).failing.includes("/storms/groups"), false);
      assert.equal(get(apiHealth).absent.includes("/storms/groups"), true);
    } finally {
      server.restore();
    }
  });
}
