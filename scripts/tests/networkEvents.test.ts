import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SHARED_NETWORK_EVENTS } from "../../src/api/events.ts";
import { ALL_NETWORKS } from "../../src/layers/networkHoles.ts";
import { PRODUCT_GROUPS } from "../../src/lib/observedProduct.ts";

/**
 * The `network` socket event names a country's composite or one of the
 * frames that share it. `CountryNetwork` is every name but the shared ones,
 * so one left out of `SHARED_NETWORK_EVENTS` would be typed as a country,
 * and drawn, sampled and holed for as one.
 */

const spec = JSON.parse(readFileSync(new URL("../../spec/api.openapi.json", import.meta.url), "utf8"));
const names: string[] = spec.components.schemas.NetworkRefresh.properties.network.enum;

test("every name the event carries is a country's network or a frame that shares the event, never both", () => {
  const shared = new Set<string>(SHARED_NETWORK_EVENTS);
  const countries = new Set<string>(ALL_NETWORKS);
  for (const name of names) assert.ok(shared.has(name) !== countries.has(name), name);
  assert.deepEqual(names.filter((name) => !shared.has(name)).sort(), [...ALL_NETWORKS].sort());
  for (const name of SHARED_NETWORK_EVENTS) assert.ok(names.includes(name), `${name} is in the schema`);
});

test("the echo tops and VIL share the event under their own product names, as the column maximum does", () => {
  const tops = PRODUCT_GROUPS.find(({ group }) => group === "tops")!.products;
  for (const product of [...tops, "colmax"]) assert.ok((SHARED_NETWORK_EVENTS as readonly string[]).includes(product), product);
});
