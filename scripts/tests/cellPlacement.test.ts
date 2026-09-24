import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { placementLabel, type Translate } from "../../src/lib/cellPlacement.ts";

/**
 * A cell's name, assembled from the parts the data service sends.
 *
 * Checked against the app's real message catalogues rather than stubs, so a
 * key that is misspelt here or missing from one language fails too. The
 * interpolation is the plain `{name}` substitution these messages use, which is
 * all of ICU MessageFormat they touch.
 */

const catalogue = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../src/locale/${lang}.json`, import.meta.url), "utf8"));

const translator = (lang: string): Translate => {
  const messages = catalogue(lang);
  return (key, options) => {
    const message = messages[key];
    assert.ok(message !== undefined, `${lang}.json has no "${key}"`);
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(options?.values?.[name]));
  };
};

const en = translator("en");
const de = translator("de");

const freising = (direction: string | null, distance_km = 18.4) => ({
  place: "Freising",
  kind: "town",
  direction,
  distance_km,
  bearing_deg: direction === null ? null : 0,
});

test("a cell with nothing to be named after has no name", () => {
  assert.equal(placementLabel(null, en), null);
  assert.equal(placementLabel(undefined, en), null);
  assert.equal(placementLabel({ ...freising("N"), place: "  " }, en), null);
});

test("the long form carries the distance, in both languages", () => {
  assert.equal(placementLabel(freising("N"), en, "long"), "18 km N of Freising");
  assert.equal(placementLabel(freising("NE"), de, "long"), "18 km NO von Freising");
});

test("the short form drops the distance a graph node has no room for", () => {
  assert.equal(placementLabel(freising("N"), en, "short"), "N of Freising");
  assert.equal(placementLabel(freising("E"), de, "short"), "O von Freising");
});

test("a cell over its place gets no direction, at either length", () => {
  // The server sends no direction inside a few kilometres, where one would
  // claim a precision the anchor does not have.
  for (const style of ["long", "short"] as const) {
    assert.equal(placementLabel(freising(null, 2.1), en, style), "Over Freising");
    assert.equal(placementLabel(freising(null, 2.1), de, style), "Über Freising");
  }
});

test("distances are whole kilometres", () => {
  assert.equal(placementLabel(freising("S", 17.5), en), "18 km S of Freising");
  assert.equal(placementLabel(freising("S", 6.04), en), "6 km S of Freising");
});

test("the place keeps the name it arrived with", () => {
  const munich = { ...freising("W"), place: "München" };
  assert.equal(placementLabel(munich, en), "18 km W of München");
});

test("every compass point the server can send is translated, in both languages", () => {
  const german: Record<string, string> = {
    N: "N", NE: "NO", E: "O", SE: "SO", S: "S", SW: "SW", W: "W", NW: "NW",
  };
  for (const [point, deName] of Object.entries(german)) {
    assert.equal(placementLabel(freising(point), en, "short"), `${point} of Freising`);
    assert.equal(placementLabel(freising(point), de, "short"), `${deName} von Freising`);
  }
});

test("a direction this client does not know is shown, not turned into 'over'", () => {
  // Folding it into "Over Freising" would say the cell sits on the town.
  assert.equal(placementLabel(freising("NNE"), en), "18 km NNE of Freising");
});
