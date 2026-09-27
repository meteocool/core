import assert from "node:assert/strict";
import test from "node:test";
import { chooseLocale, normaliseLocale } from "../../src/locale/choose.ts";

/**
 * The frontend's language: the browser's (in the apps, the system's), unless
 * the URL says. Wrong, a German phone shows an English map.
 */

test("region and case do not matter, languages we lack are null", () => {
  assert.equal(normaliseLocale("de-AT"), "de");
  assert.equal(normaliseLocale("DE_de"), "de");
  assert.equal(normaliseLocale("en-GB"), "en");
  assert.equal(normaliseLocale("fr-FR"), "fr");
  assert.equal(normaliseLocale("sk"), "sk");
  assert.equal(normaliseLocale("it-IT"), null);
  assert.equal(normaliseLocale(""), null);
  assert.equal(normaliseLocale(null), null);
});

test("the URL beats the browser", () => {
  assert.equal(chooseLocale({ url: "en", browser: ["de-DE"] }), "en");
});

test("a URL language we lack falls through to the browser", () => {
  assert.equal(chooseLocale({ url: "it", browser: ["de-CH", "en"] }), "de");
});

test("the browser's first language we have wins, in its order", () => {
  assert.equal(chooseLocale({ browser: ["it-IT", "de-AT", "en-GB"] }), "de");
  assert.equal(chooseLocale({ browser: ["nl-BE", "de-DE"] }), "nl");
  assert.equal(chooseLocale({ browser: ["en-GB", "de-DE"] }), "en");
});

test("nothing we have is English", () => {
  assert.equal(chooseLocale({ browser: ["it", "es"] }), "en");
  assert.equal(chooseLocale({}), "en");
});
