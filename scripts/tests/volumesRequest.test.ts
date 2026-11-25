import assert from "node:assert/strict";
import test from "node:test";
import { fetchCurrentVolumes, volumesQuery } from "../../src/api/index.ts";
import { volumesAsked } from "../../src/lib/volumeLevels.ts";
import { rainBoxes } from "../../src/lib/studio/flight/rainView.ts";
import { systemsAt } from "../../src/lib/studio/flight/fallback.ts";

/**
 * Fill tiles, the weak rain between the storms, are asked for by meteoair's
 * own page alone. Every other caller of `/cells/volumes` asks exactly what it
 * did before there were any: a request with `fill` in it is another answer
 * (and another cache entry), so a stray one would change what the map draws.
 */

const AT = 1764072000;
const AT_ISO = "2025-11-25T12:00:00Z";

/** A backend that answers every request with an empty list, keeping each URL asked. */
function backend() {
  const asked: URL[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    asked.push(url);
    const body = url.pathname.endsWith("/strikes") ? { strikes: [] } : { volumes: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const volumes = () => asked.filter((url) => url.pathname === "/cells/volumes").map((url) => Object.fromEntries(url.searchParams));
  return { volumes, restore: () => { globalThis.fetch = original; } };
}

test("a query leaves out what is off", () => {
  assert.deepEqual(volumesQuery({}), {});
  assert.deepEqual(volumesQuery({ coarse: true, at: AT }), { coarse: true, at: AT_ISO });
  assert.deepEqual(volumesQuery({ coarse: true, fill: true, at: null }), { coarse: true, fill: true });
  assert.deepEqual(volumesQuery({ fill: false, at: AT }), { at: AT_ISO });
});

test("the 3D map asks for coarse tiles and no fill; meteoair's page for fill as well", async () => {
  const server = backend();
  try {
    await fetchCurrentVolumes(undefined, volumesAsked(false, AT));
    await fetchCurrentVolumes(undefined, volumesAsked(false, null));
    await fetchCurrentVolumes(undefined, volumesAsked(true, AT));
    assert.deepEqual(server.volumes(), [
      { coarse: "true", at: AT_ISO },
      { coarse: "true" },
      { coarse: "true", fill: "true", at: AT_ISO },
    ]);
  } finally {
    server.restore();
  }
});

test("the flat map, the flight's view onto the rain and its storm check ask as they did", async () => {
  const server = backend();
  try {
    // App.svelte's own lookups: no coarse tiles, no fill.
    await fetchCurrentVolumes(undefined, { at: AT });
    // The view the flight's page opens on picks from the storms' own tiles.
    await rainBoxes(AT);
    // Whether the sky has a storm worth flying at: the storms' coarse tiles.
    await systemsAt(AT, AT * 1000);
    assert.deepEqual(server.volumes(), [
      { at: AT_ISO },
      { at: AT_ISO },
      { coarse: "true", at: AT_ISO },
    ]);
  } finally {
    server.restore();
  }
});
