import assert from "node:assert/strict";
import test from "node:test";
import {
  blitzortungAttribution, chmiAttribution, dwdAttribution, imgwAttribution, imprintAttribution,
  meteoSwissAttribution, orderAttributions, osmAttribution, protomapsAttribution,
} from "../../src/layers/attributions.ts";

/**
 * The corner's credits read base map, data, imprint -- whatever order the
 * layers that carry them were added to the map in.
 */

test("credits come in a fixed order, the imprint last", () => {
  // As OpenLayers collected them on a radar map: lightning first, being built first.
  const collected = [
    blitzortungAttribution, imprintAttribution, osmAttribution, protomapsAttribution,
    chmiAttribution, imgwAttribution, meteoSwissAttribution, dwdAttribution,
  ];
  assert.deepEqual(orderAttributions(collected), [
    osmAttribution, protomapsAttribution, dwdAttribution, meteoSwissAttribution,
    chmiAttribution, imgwAttribution, blitzortungAttribution, imprintAttribution,
  ]);
});

test("a credit the order does not know stays among the data, before the imprint", () => {
  const other = "© Somebody";
  assert.deepEqual(
    orderAttributions([imprintAttribution, other, osmAttribution]),
    [osmAttribution, other, imprintAttribution],
  );
});
