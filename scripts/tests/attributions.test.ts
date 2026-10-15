import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTRIBUTION_ORDER, blitzortungAttribution, chmiAttribution, dwdAttribution, imgwAttribution, imprintAttribution,
  meteoSwissAttribution, orderAttributions, osmAttribution, protomapsAttribution, rmiVmmAttribution, shmuAttribution,
} from "../../src/layers/attributions.ts";

/**
 * The corner's credits read base map, data, imprint, whatever order the
 * layers that carry them were added to the map in.
 */

test("credits come in a fixed order, the imprint last", () => {
  // As OpenLayers collected them on a radar map: lightning first, being built first.
  const collected = [
    blitzortungAttribution, imprintAttribution, osmAttribution, protomapsAttribution, shmuAttribution,
    chmiAttribution, imgwAttribution, rmiVmmAttribution, meteoSwissAttribution, dwdAttribution,
  ];
  assert.deepEqual(orderAttributions(collected), [
    osmAttribution, protomapsAttribution, dwdAttribution, meteoSwissAttribution,
    chmiAttribution, imgwAttribution, rmiVmmAttribution, shmuAttribution, blitzortungAttribution, imprintAttribution,
  ]);
});

test("a credit the order does not know stays among the data, before the imprint", () => {
  const other = "© Somebody";
  assert.deepEqual(
    orderAttributions([imprintAttribution, other, osmAttribution]),
    [osmAttribution, other, imprintAttribution],
  );
});

/**
 * The corner names a source; imprint.html#data says what its licence asks
 * for. A credit added to the map without a line in the imprint is half done.
 */
test("the imprint's data section covers every credit on the map", () => {
  const imprint = readFileSync(new URL("../../imprint.html", import.meta.url), "utf8");
  const data = imprint.slice(imprint.indexOf("id=\"data\""), imprint.indexOf("id=\"software\""));
  assert.ok(data.length > 0, "imprint.html has no #data section before #software");
  for (const credit of ATTRIBUTION_ORDER) {
    if (credit === imprintAttribution) continue;
    // Every source a credit links, as Belgium's names two operators.
    const hrefs = [...credit.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    if (hrefs.length) {
      for (const href of hrefs) assert.ok(data.includes(`href="${href}"`), `imprint.html#data does not link ${href}`);
    } else {
      const name = credit.replace(/^©\s*/, "").toLowerCase();
      assert.ok(data.toLowerCase().includes(name), `imprint.html#data does not mention "${name}"`);
    }
  }
});
