import assert from "node:assert/strict";
import test from "node:test";
import { alternateLocales, PREVIEW_COPY, previewCopy } from "../../worker/previewCopy.ts";
import { LOCALES } from "../../src/locale/choose.ts";

/** Every language the app speaks has its own preview and search copy. */

test("every app language has its own copy, each ending in the motto, which only French translates", () => {
  assert.deepEqual(Object.keys(PREVIEW_COPY).sort(), [...LOCALES].sort());
  const descriptions = new Set<string>();
  for (const [lang, copy] of Object.entries(PREVIEW_COPY)) {
    assert.match(copy.locale, new RegExp(`^${lang}_[A-Z]{2}$`), lang);
    assert.ok(copy.title.startsWith("meteocool – "), lang);
    assert.ok(copy.description.endsWith(lang === "fr" ? "Chassez l'orage ou évitez-le." : "Chase it or avoid it."), lang);
    assert.match(copy.description, /2018/, lang);
    assert.match(copy.description, /VIL/, lang);
    descriptions.add(copy.description);
  }
  assert.equal(descriptions.size, LOCALES.length);
});

test("share_lang picks the copy, English for none or a language the app lacks", () => {
  assert.equal(previewCopy("de"), PREVIEW_COPY.de);
  assert.equal(previewCopy("fr-FR"), PREVIEW_COPY.fr);
  assert.equal(previewCopy("no"), PREVIEW_COPY.nb);
  assert.equal(previewCopy("ja"), PREVIEW_COPY.en);
  assert.equal(previewCopy(null), PREVIEW_COPY.en);
  assert.equal(previewCopy("constructor"), PREVIEW_COPY.en);
  assert.equal(previewCopy("__proto__"), PREVIEW_COPY.en);
});

test("a copy's alternates are every other language's locale", () => {
  const alternates = alternateLocales(PREVIEW_COPY.de);
  assert.equal(alternates.length, LOCALES.length - 1);
  assert.ok(!alternates.includes("de_DE"));
  assert.ok(alternates.includes("en_US"));
});
