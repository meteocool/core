import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ATTRIBUTION_ORDER, blitzortungAttribution, chmiAttribution, dhmzAttribution, dmiAttribution, dwdAttribution,
  fmiAttribution, imgwAttribution, imprintAttribution, kaurAttribution, knmiAttribution, lhmtAttribution,
  meteoSwissAttribution, metEireannAttribution, metNorwayAttribution, orderAttributions, osmAttribution,
  protomapsAttribution, rmiVmmAttribution, shmuAttribution, smhiAttribution,
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

/**
 * Every radar entry in the imprint links the licence its data is shown
 * under, Belgium's two owners each in their own entry.
 */
test("every radar entry in the imprint links its licence", () => {
  const imprint = readFileSync(new URL("../../imprint.html", import.meta.url), "utf8");
  const radar = imprint.slice(imprint.indexOf("<h3>Radar</h3>"), imprint.indexOf("</ul>", imprint.indexOf("<h3>Radar</h3>")));
  const entries = radar.split("<li>").slice(1);
  assert.ok(entries.length > 0, "imprint.html has no radar list under <h3>Radar</h3>");
  const licences = [
    "https://creativecommons.org/licenses/by/4.0/",
    "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  ];
  for (const entry of entries) {
    const hrefs = [...entry.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(
      hrefs.some((href) => licences.some((licence) => href === licence)),
      `no licence linked in: ${entry.replace(/\s+/g, " ").trim()}`,
    );
  }
});

test("the networks of the second wave are credited in the coverage document's order, after SHMÚ", () => {
  // As OpenLayers might collect them over the Baltic and Scandinavia.
  const collected = [
    metNorwayAttribution, imprintAttribution, smhiAttribution, fmiAttribution, osmAttribution, kaurAttribution,
    lhmtAttribution, dmiAttribution, knmiAttribution, metEireannAttribution, dhmzAttribution, shmuAttribution,
  ];
  assert.deepEqual(orderAttributions(collected), [
    osmAttribution, shmuAttribution, lhmtAttribution, kaurAttribution, metEireannAttribution, dhmzAttribution,
    dmiAttribution, knmiAttribution, fmiAttribution, smhiAttribution, metNorwayAttribution, imprintAttribution,
  ]);
});

/**
 * Where a provider's own terms and EUMETNET's metadata name different
 * licences, the imprint credits under both: Lithuania (CC BY 4.0 and
 * CC BY-SA 4.0), Croatia (CC BY 4.0 and the Croatian Open Licence) and
 * Norway (NLOD 2.0 and CC BY 4.0).
 */
test("a radar under two licences is credited under both", () => {
  const imprint = readFileSync(new URL("../../imprint.html", import.meta.url), "utf8");
  const radar = imprint.slice(imprint.indexOf("<h3>Radar</h3>"), imprint.indexOf("</ul>", imprint.indexOf("<h3>Radar</h3>")));
  const entry = (country: string) => radar.split("<li>").find((li) => li.trim().startsWith(country)) ?? "";
  const cc = "https://creativecommons.org/licenses/by/4.0/";
  for (const [country, other] of [
    ["Lithuania", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["Croatia", "https://data.gov.hr/otvorena-dozvola"],
    ["Norway", "https://data.norge.no/nlod/en/2.0"],
  ]) {
    assert.ok(entry(country).includes(`href="${cc}"`), `${country} does not link CC BY 4.0`);
    assert.ok(entry(country).includes(`href="${other}"`), `${country} does not link ${other}`);
  }
});

test("Ireland's entry makes Met Éireann's five statements", () => {
  const imprint = readFileSync(new URL("../../imprint.html", import.meta.url), "utf8");
  const radar = imprint.slice(imprint.indexOf("<h3>Radar</h3>"), imprint.indexOf("</ul>", imprint.indexOf("<h3>Radar</h3>")));
  const ireland = (radar.split("<li>").find((li) => li.trim().startsWith("Ireland")) ?? "").replace(/\s+/g, " ");
  assert.match(ireland, /Copyright Met &Eacute;ireann/);
  assert.match(ireland, /Source: <a href="https:\/\/www\.met\.ie\/">www\.met\.ie<\/a>/);
  assert.match(ireland, /Creative Commons Attribution 4\.0 International licence/);
  assert.match(ireland, /has been modified/);
  assert.match(ireland, /does not accept any liability whatsoever/);
});
