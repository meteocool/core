import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  infoFileOf, infoText, sourceLabels, textFileOf, textLanguage, withTexts,
  type RadarFactsFile, type RadarInfo, type RadarTextFile,
} from "../../src/lib/radarInfo.ts";
import { RADAR_SITES } from "../../src/lib/radarSites.ts";
import { LOCALES } from "../../src/locale/choose.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const INFO_DIR = path.join(ROOT, "src", "radarInfo");
const TEXT_DIR = path.join(INFO_DIR, "text");
const PHOTO_DIR = path.join(ROOT, "public", "radars");

const entry = (text: RadarInfo["text"]): RadarInfo => ({
  operator: null, system: null, band: null, dualPol: null, since: null, towerM: null, text, photo: null, sources: [],
});

const readAll = <T>(dir: string): Record<string, T> => Object.fromEntries(readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(dir, name), "utf8"))]));
const files = readAll<RadarFactsFile>(INFO_DIR);
const texts = readAll<RadarTextFile>(TEXT_DIR);

test("a German reader reads the German text, whichever region their German is from", () => {
  const info = entry({ en: "On a hill.", de: "Auf einem Hügel." });
  assert.equal(infoText(info, "de"), "Auf einem Hügel.");
  assert.equal(infoText(info, "de-AT"), "Auf einem Hügel.");
});

test("a reader in a language the app does not speak reads the English text", () => {
  const info = entry({ en: "On a hill.", de: "Auf einem Hügel." });
  assert.equal(infoText(info, "en"), "On a hill.");
  assert.equal(infoText(info, "pt-BR"), "On a hill.");
  assert.equal(infoText(info, null), "On a hill.");
});

test("a text not yet translated reads in English", () => {
  assert.equal(infoText(entry({ en: "On a hill." }), "pl"), "On a hill.");
});

test("a Norwegian reader on an older system reads Bokmål", () => {
  assert.equal(textLanguage("no"), "nb");
  assert.equal(textLanguage("nn-NO"), "nb");
});

test("a radar's text in a language is in that language's file for its country", () => {
  assert.equal(textFileOf("deisn", "fr"), "radar-text-fr-de");
  assert.equal(textFileOf("isn", "en"), "radar-text-en-de");
});

test("a radar takes its text from each language's file that has one", () => {
  const facts = { operator: "DWD", system: null, band: null, dualPol: null, since: null, towerM: null, photo: null, sources: [] };
  const info = withTexts("deisn", facts, { en: { deisn: "On a hill." }, fr: { deoft: "Sur une colline." } });
  assert.deepEqual(info.text, { en: "On a hill." });
  assert.equal(info.operator, "DWD");
});

test("a radar's texts are in its country's file", () => {
  assert.equal(infoFileOf("deisn"), "radar-info-de");
  assert.equal(infoFileOf("frnan"), "radar-info-fr");
  // DWD's bare three letters, from volumes older than the other networks.
  assert.equal(infoFileOf("isn"), "radar-info-de");
});

test("every radar there is has an entry, in its country's file", () => {
  for (const code of Object.keys(RADAR_SITES)) {
    assert.ok(files[infoFileOf(code)]?.[code], `${code} has no entry in ${infoFileOf(code)}.json`);
  }
});

test("every entry is a radar there is, in its own country's file", () => {
  for (const [file, radars] of Object.entries(files)) {
    for (const code of Object.keys(radars)) {
      assert.ok(RADAR_SITES[code], `${file}.json describes ${code}, which is no radar`);
      assert.equal(infoFileOf(code), file, `${code} is in ${file}.json`);
    }
  }
});

test("every radar has a text of a few sentences in every language the app speaks", () => {
  for (const language of LOCALES) {
    for (const code of Object.keys(RADAR_SITES)) {
      const text = texts[textFileOf(code, language)]?.[code] ?? "";
      assert.ok(text.length >= 60, `${code}'s ${language} text is missing or too short`);
      assert.ok(text.length <= 600, `${code}'s ${language} text runs to ${text.length} characters`);
    }
  }
});

test("every text file holds only its own country's radars", () => {
  for (const [file, radars] of Object.entries(texts)) {
    const language = /^radar-text-([a-z]+)-/.exec(file)?.[1] ?? "";
    for (const code of Object.keys(radars)) assert.equal(textFileOf(code, language), file, `${code} is in ${file}.json`);
  }
});

test("every photo is in the repository and says whose it is and under which licence", () => {
  const shown = new Set<string>();
  for (const radars of Object.values(files)) {
    for (const [code, info] of Object.entries(radars)) {
      if (!info.photo) continue;
      const { src, author, licence, page, width, height } = info.photo;
      assert.equal(src, `/radars/${code}.webp`);
      assert.ok(existsSync(path.join(ROOT, "public", src)), `${src} is missing`);
      assert.ok(author.trim() && licence.trim(), `${code}'s photo names no author or licence`);
      assert.match(page, /^https:\/\//, `${code}'s photo links to no page of its own`);
      assert.ok(width > 0 && height > 0);
      shown.add(`${code}.webp`);
    }
  }
  // And none is shipped that no radar shows.
  for (const name of readdirSync(PHOTO_DIR)) assert.ok(shown.has(name), `public/radars/${name} is shown by no radar`);
});

test("a source is named by who published it, where it is a known publisher", () => {
  assert.deepEqual(sourceLabels([
    "https://www.dwd.de/DE/derdwd/messnetz/atmosphaerenbeobachtung/_functions/HaeufigGesucht/radarverbund.html",
    "https://de.wikipedia.org/wiki/Wetterradar",
    "https://wrd.mgm.gov.tr/Home/Detail?id=1",
    "https://www.schwaebische.de/a/radar",
  ]), ["DWD", "Wikipedia (de)", "WMO Weather Radar Database", "schwaebische.de"]);
});

test("two sources from the same publisher are told apart", () => {
  assert.deepEqual(sourceLabels(["https://www.smhi.se/a", "https://www.smhi.se/b", "https://www.met.no/c"]),
    ["SMHI 1", "SMHI 2", "MET Norway"]);
});

test("every radar names where its text and facts come from", () => {
  for (const radars of Object.values(files)) {
    for (const [code, info] of Object.entries(radars)) {
      assert.ok(info.sources.length > 0, `${code} names no source`);
      for (const url of info.sources) assert.match(url, /^https?:\/\/[^/]+\.[a-z]+/, `${code}: ${url}`);
    }
  }
});
