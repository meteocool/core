import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import { selectedStorm } from "../../src/stores.ts";
import { startStormResolver } from "../../src/lib/stormResolver.ts";
import { fromStorm } from "../../src/lib/stormSelection.ts";
import { detail, feature, sid, storm, trackerTrack } from "./stormFixtures.ts";
import type { StormDetail } from "../../src/api/index.ts";

/**
 * The resolver fetches the open storm's detail, the part of the panel below
 * its readings (history, insides, lineage). Reopening a storm must bring that
 * back, whether or not the backend is asked again.
 */

const A = sid("A");
const B = sid("B");

const full = (id: string): StormDetail => detail(storm(id), {
  tracks: [trackerTrack(`${id}-t`, [feature(`${id}-1`, -10), feature(`${id}-2`, -5), feature(`${id}-3`, 0)])],
});

/** A backend that answers `/storms/{id}` from `answers`, counting what it is asked. */
function backend(answers: (id: string, call: number) => StormDetail | null) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const id = decodeURIComponent(url.split("/storms/")[1] ?? "");
    calls.push(id);
    const answer = answers(id, calls.filter((one) => one === id).length);
    return answer
      ? new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } })
      // Refused outright: a 5xx would be retried inside the request itself.
      : new Response("{}", { status: 400, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

test("a storm reopened in the same cycle gets its detail back", async () => {
  const server = backend((id) => full(id));
  selectedStorm.set(null);
  const resolver = startStormResolver();
  try {
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    assert.equal(get(selectedStorm)?.detail?.tracks?.length, 1);

    // Closed, then tapped again before the storm has moved on.
    selectedStorm.set(null);
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    assert.equal(get(selectedStorm)?.detail?.tracks?.[0].features?.length, 3);
  } finally {
    resolver.stop();
    server.restore();
  }
});

test("a storm left before its detail landed gets it when tapped again", async () => {
  const server = backend((id) => full(id));
  selectedStorm.set(null);
  const resolver = startStormResolver();
  try {
    selectedStorm.set(fromStorm(storm(A)));
    selectedStorm.set(fromStorm(storm(B)));
    await settle();
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    assert.equal(get(selectedStorm)?.detail?.storm.id, A);
  } finally {
    resolver.stop();
    server.restore();
  }
});

test("a detail that failed to load is asked for again", async () => {
  const server = backend((id, call) => (call === 1 ? null : full(id)));
  selectedStorm.set(null);
  const resolver = startStormResolver();
  try {
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    assert.equal(get(selectedStorm)?.detail, null);
    selectedStorm.set(null);
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    assert.equal(get(selectedStorm)?.detail?.storm.id, A);
  } finally {
    resolver.stop();
    server.restore();
  }
});

test("a refresh that comes back without history keeps the history already shown", async () => {
  const server = backend((id, call) => (call === 1 ? full(id) : detail(storm(id))));
  selectedStorm.set(null);
  const resolver = startStormResolver();
  try {
    selectedStorm.set(fromStorm(storm(A)));
    await settle();
    resolver.refresh();
    await settle();
    assert.equal(server.calls.length, 2);
    assert.equal(get(selectedStorm)?.detail?.tracks?.[0].features?.length, 3);
  } finally {
    resolver.stop();
    server.restore();
  }
});
