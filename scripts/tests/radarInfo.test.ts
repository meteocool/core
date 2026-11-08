import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { infoFileOf, infoText, type RadarInfo, type RadarInfoFile } from "../../src/lib/radarInfo.ts";
import { RADAR_SITES } from "../../src/lib/radarSites.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const INFO_DIR = path.join(ROOT, "src", "radarInfo");
const PHOTO_DIR = path.join(ROOT, "public", "radars");

const entry = (text: RadarInfo["text"]): RadarInfo => ({
  operator: null, system: null, band: null, dualPol: null, since: null, towerM: null, text, photo: null,
});

const files: Record<string, RadarInfoFile> = Object.fromEntries(readdirSync(INFO_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(INFO_DIR, name), "utf8"))]));

test("a German reader reads the German text, whichever region their German is from", () => {
  const info = entry({ en: "On a hill.", de: "Auf einem Hügel." });
  assert.equal(infoText(info, "de"), "Auf einem Hügel.");
  assert.equal(infoText(info, "de-AT"), "Auf einem Hügel.");
});

test("every other language reads the English text", () => {
  const info = entry({ en: "On a hill.", de: "Auf einem Hügel." });
  assert.equal(infoText(info, "en"), "On a hill.");
  assert.equal(infoText(info, "pl"), "On a hill.");
  assert.equal(infoText(info, null), "On a hill.");
});

test("a radar with no German text reads in English in German too", () => {
  assert.equal(infoText(entry({ en: "On a hill." }), "de"), "On a hill.");
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

test("every text is a few sentences, in English and German", () => {
  for (const radars of Object.values(files)) {
    for (const [code, info] of Object.entries(radars)) {
      for (const language of ["en", "de"] as const) {
        const text = info.text[language] ?? "";
        assert.ok(text.length >= 60, `${code}'s ${language} text is missing or too short`);
        assert.ok(text.length <= 480, `${code}'s ${language} text runs to ${text.length} characters`);
      }
    }
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
