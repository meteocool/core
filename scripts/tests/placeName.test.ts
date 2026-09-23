import assert from "node:assert/strict";
import test from "node:test";
import Feature from "ol/Feature.js";
import { placeNameForLocale } from "../../src/layers/placeName.ts";

test("map names use the device language, then English, then the local name", () => {
  const country = new Feature({
    name: "Deutschland", "name:de": "Deutschland", "name:en": "Germany",
    "name:fr": "Allemagne", "name:zh-Hans": "德国", "name:zh-Hant": "德國",
  });
  for (const [locale, expected] of [
    ["en-US", "Germany"], ["de-AT", "Deutschland"], ["fr-CA", "Allemagne"],
    ["eo", "Germany"], [null, "Germany"], ["", "Germany"], ["not_a_locale", "Germany"],
    ["zh-CN", "德国"], ["zh-TW", "德國"], ["zh-Hant-HK", "德國"],
    ["zh-Hans-TW", "德国"], ["FR-ca", "Allemagne"],
  ]) {
    assert.equal(placeNameForLocale(locale)(country), expected, String(locale));
  }
  const french = placeNameForLocale("fr-FR");
  assert.equal(french(new Feature({ name: "München", "name:en": "Munich" })), "Munich");
  assert.equal(french(new Feature({ name: "München", "name:fr": " ", "name:en": "Munich" })), "Munich");
  assert.equal(french(new Feature({ name: "Dorf", "name:en": "" })), "Dorf");
  assert.equal(french(new Feature({ name: "Dorf", "name:fr": 123 })), "Dorf");
  assert.equal(french(new Feature()), undefined);
});
