import assert from "node:assert/strict";
import test from "node:test";
import {
  ageOf, dealt, isMatch, MATCH_CHANCE, MATCHES_KEY, parseMatches, readMatches, shuffled, swipeThreshold, tagsOf, tiltOf,
  upcoming, verdictOf, withMatch, writeMatches, type Translate,
} from "../../src/lib/meetYouCool.ts";
import { isMeetYouCoolHash } from "../../src/lib/meetYouCoolLink.ts";
import type { RadarInfo } from "../../src/lib/radarInfo.ts";
import { RADAR_SITES } from "../../src/lib/radarSites.ts";

const known = (code: string) => code in RADAR_SITES;

/** A storage that keeps what it is given, as localStorage does. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, String(value)); },
  };
}

const throwing = (): Storage => { throw new Error("SecurityError: storage is disabled"); };

test("a like is a match when the chance comes up under one in three", () => {
  assert.equal(MATCH_CHANCE, 1 / 3);
  assert.equal(isMatch(() => 0), true);
  assert.equal(isMatch(() => 0.33), true);
  assert.equal(isMatch(() => 1 / 3), false);
  assert.equal(isMatch(() => 0.99), false);
});

test("about a third of likes are matches", () => {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let matches = 0;
  for (let i = 0; i < 3000; i += 1) if (isMatch(random)) matches += 1;
  assert.ok(matches > 900 && matches < 1100, `${matches} of 3000`);
});

test("a radar's age is the years since it went into service", () => {
  assert.equal(ageOf("2012", 2026), 14);
  assert.equal(ageOf("2026", 2026), 0);
});

test("a radar with no year, or something other than a year, has no age", () => {
  assert.equal(ageOf(null, 2026), null);
  assert.equal(ageOf(undefined, 2026), null);
  assert.equal(ageOf("", 2026), null);
  assert.equal(ageOf("the nineties", 2026), null);
});

test("a radar dated after this year has no age rather than a negative one", () => {
  assert.equal(ageOf("2030", 2026), null);
});

test("only radars with a photo are dealt, and only those on the map", () => {
  const photo = { src: "/radars/deoft.webp", width: 800, height: 600, author: "A", licence: "CC0", licenceUrl: null, page: "https://example.org" };
  const entry = (withPhoto: boolean): RadarInfo => ({
    operator: null, system: null, band: null, dualPol: null, since: null, towerM: null,
    text: { en: "On a hill." }, photo: withPhoto ? photo : null,
  });
  assert.deepEqual(dealt({ deoft: entry(true), deisn: entry(false), xxnone: entry(true) }, known), ["deoft"]);
});

test("the stack is shuffled, and every radar is still in it once", () => {
  const codes = ["defbg", "deisn", "frnan", "plleg", "chdol"];
  const order = shuffled(codes, () => 0);
  assert.notDeepEqual(order, codes);
  assert.deepEqual([...order].sort(), [...codes].sort());
  assert.deepEqual(codes, ["defbg", "deisn", "frnan", "plleg", "chdol"], "the input is left as it was");
});

test("the next cards are the stack's first ones not yet swiped", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(upcoming(order, new Set(), 2), ["a", "b"]);
  assert.deepEqual(upcoming(order, new Set(["a", "c"]), 2), ["b", "d"]);
});

test("a stack swiped through has no next card", () => {
  assert.deepEqual(upcoming(["a", "b"], new Set(["a", "b"]), 3), []);
});

test("a drag past the threshold to the right is a like, to the left a nope", () => {
  const width = 360;
  const threshold = swipeThreshold(width);
  assert.equal(verdictOf(threshold, width), "like");
  assert.equal(verdictOf(-threshold, width), "nope");
});

test("a short, slow drag is no swipe and the card goes back", () => {
  assert.equal(verdictOf(60, 360), null);
  assert.equal(verdictOf(-60, 360, -0.1), null);
});

test("a quick flick counts before the threshold, but only in the direction it was dragged", () => {
  assert.equal(verdictOf(50, 360, 1), "like");
  assert.equal(verdictOf(-50, 360, -1), "nope");
  assert.equal(verdictOf(50, 360, -1), null);
});

test("a twitch is no flick, however fast", () => {
  assert.equal(verdictOf(10, 360, 3), null);
});

test("the threshold follows the card's width, within bounds", () => {
  assert.equal(swipeThreshold(100), 80);
  assert.equal(swipeThreshold(400), 120);
  assert.equal(swipeThreshold(2000), 160);
});

test("a dragged card leans the way it goes, never past 15 degrees", () => {
  assert.ok(tiltOf(100, 400) > 0);
  assert.ok(tiltOf(-100, 400) < 0);
  assert.equal(tiltOf(0, 400), 0);
  assert.equal(tiltOf(5000, 400), 15);
  assert.equal(tiltOf(-5000, 400), -15);
  assert.equal(tiltOf(100, 0), 0);
});

test("matches are kept newest first, a radar only once", () => {
  let matches = withMatch([], "defbg", 1);
  matches = withMatch(matches, "deisn", 2);
  matches = withMatch(matches, "defbg", 3);
  assert.deepEqual(matches, [{ code: "defbg", at: 3 }, { code: "deisn", at: 2 }]);
});

test("stored matches that do not parse are dropped, and the rest kept", () => {
  assert.deepEqual(parseMatches(null, known), []);
  assert.deepEqual(parseMatches("not json", known), []);
  assert.deepEqual(parseMatches("{\"code\":\"defbg\"}", known), []);
  const raw = JSON.stringify([
    { code: "defbg", at: 2 }, { code: 7, at: 1 }, { code: "deisn" }, null, { code: "deisn", at: Infinity },
    { code: "frnan", at: 1 },
  ]);
  assert.deepEqual(parseMatches(raw, known), [{ code: "defbg", at: 2 }, { code: "frnan", at: 1 }]);
});

test("a stored match with a radar no longer on the map is dropped", () => {
  assert.deepEqual(parseMatches(JSON.stringify([{ code: "xxgone", at: 1 }]), known), []);
});

test("matches written to storage read back the same", () => {
  const storage = memoryStorage();
  const matches = [{ code: "defbg", at: 2 }, { code: "frnan", at: 1 }];
  assert.equal(writeMatches(() => storage, matches), true);
  assert.equal(typeof storage.getItem(MATCHES_KEY), "string");
  assert.deepEqual(readMatches(() => storage, known), matches);
});

test("with storage switched off there are no matches, and keeping one fails quietly", () => {
  assert.deepEqual(readMatches(throwing, known), []);
  assert.equal(writeMatches(throwing, [{ code: "defbg", at: 1 }]), false);
  assert.deepEqual(readMatches(() => null, known), []);
  assert.equal(writeMatches(() => null, []), false);
});

test("a full storage fails to keep a match quietly", () => {
  const full = { setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(writeMatches(() => full, [{ code: "defbg", at: 1 }]), false);
});

const tr: Translate = (key, options) => `${key}${options?.values ? JSON.stringify(options.values) : ""}`;
const num = (value: number) => String(value);
const info = (fields: Partial<RadarInfo>): RadarInfo => ({
  operator: null, system: null, band: null, dualPol: null, since: null, towerM: null, text: { en: "" }, photo: null,
  ...fields,
});

test("a profile's chips list every fact there is, in order", () => {
  const tags = tagsOf(info({ operator: "DWD", system: "EEC", band: "C", dualPol: true, towerM: 30 }), RADAR_SITES.defbg, tr, num);
  assert.deepEqual(tags.map((tag) => tag.kind), ["operator", "system", "band", "polarisation", "tower", "antenna", "range"]);
  assert.equal(tags[0].text, "DWD");
  assert.equal(tags[3].text, "meet.tag.dual_pol");
  assert.equal(tags[5].text, `meet.tag.antenna{"height":"${RADAR_SITES.defbg.heightM}"}`);
});

test("a fact nobody found is no chip", () => {
  const tags = tagsOf(info({ band: "C" }), undefined, tr, num);
  assert.deepEqual(tags.map((tag) => tag.kind), ["band"]);
});

test("a single-polarisation radar says so", () => {
  const tags = tagsOf(info({ dualPol: false }), undefined, tr, num);
  assert.deepEqual(tags.map((tag) => tag.text), ["meet.tag.single_pol"]);
});

test("#meetyoucool opens the screen, in any case, and nothing else does", () => {
  assert.equal(isMeetYouCoolHash("#meetyoucool"), true);
  assert.equal(isMeetYouCoolHash("#MeetYouCool"), true);
  assert.equal(isMeetYouCoolHash(""), false);
  assert.equal(isMeetYouCoolHash(null), false);
  assert.equal(isMeetYouCoolHash("#meetyoucool2"), false);
});
