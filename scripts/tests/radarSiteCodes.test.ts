import assert from "node:assert/strict";
import test from "node:test";
import { countryOf, siteCode } from "../../src/lib/radarSites.ts";

/** A storm panel's radars: which site each is, and its country. */

test("a volume's radar is named as site mode names it, DWD's bare codes included", () => {
  assert.equal(siteCode("defld"), "defld");
  assert.equal(siteCode("FLD"), "defld");
  assert.equal(siteCode("frnan"), "frnan");
});

test("a radar's country is its code's", () => {
  assert.equal(countryOf("bewid"), "be");
  assert.equal(countryOf("ess"), "de");
});
