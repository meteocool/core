import assert from "node:assert/strict";
import test from "node:test";
import { chooseLocale, normaliseLocale } from "../../src/locale/choose.ts";

/**
 * The frontend's language: the app's when it says, the browser's otherwise.
 * Wrong, a German app shows an English map, or the other way round.
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

test("the app beats the browser, and the URL beats the stored app setting", () => {
  assert.equal(chooseLocale({ app: "de", browser: ["en-US"] }), "de");
  assert.equal(chooseLocale({ url: "en", app: "de", browser: ["de-DE"] }), "en");
});

test("an app language we lack falls through to the browser", () => {
  assert.equal(chooseLocale({ app: "it", browser: ["de-CH", "en"] }), "de");
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
