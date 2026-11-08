/**
 * The rules of "meet you cool", the radars' dating screen
 * (components/MeetYouCool.svelte): who is next in the stack, how far a card
 * has to go before it counts as a swipe, how old a radar is, whether a like
 * is a match, and the matches kept in the browser.
 *
 * Pure, so the screen's decisions can be tested without a DOM: chance comes
 * in as a function, storage as a getter, and words through the translator
 * the caller hands in.
 */
import type { RadarInfo } from "./radarInfo";
import type { RadarSite } from "./radarSites";

/** A source of numbers in [0, 1), as Math.random is. */
export type Random = () => number;

/**
 * How often a like is a match: one in three. Often enough that a reader
 * sees one within a few likes, rarely enough that it is still news.
 */
export const MATCH_CHANCE = 1 / 3;

/** Whether a like is a match. */
export function isMatch(random: Random = Math.random): boolean {
  return random() < MATCH_CHANCE;
}

/**
 * A radar's age in years, from the year it went into service: the radar now
 * standing there, not the site. Null where nobody wrote the year down, or
 * where it is not a year at all.
 */
export function ageOf(since: string | null | undefined, year: number): number | null {
  const match = /^\s*(\d{4})\s*$/.exec(since ?? "");
  if (!match) return null;
  const age = year - Number(match[1]);
  return age >= 0 ? age : null;
}

/** A copy of `items` in a random order (Fisher–Yates). */
export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The next `count` radars of the stack that have not been swiped yet, the top one first. */
export function upcoming(order: readonly string[], swiped: ReadonlySet<string>, count: number): string[] {
  const out: string[] = [];
  for (const code of order) {
    if (out.length >= count) break;
    if (!swiped.has(code)) out.push(code);
  }
  return out;
}

export type Verdict = "like" | "nope";

/** The shortest drag that counts as a swipe, however narrow the card. */
const MIN_THRESHOLD_PX = 80;
/** The longest drag a swipe needs, however wide the card. */
const MAX_THRESHOLD_PX = 160;
/** A flick: fast enough (px/ms) to count before the threshold... */
const FLICK_SPEED = 0.6;
/** ...once it has gone at least this far, so a twitch is not a swipe. */
const FLICK_MIN_PX = 40;

/** How far a card `width` wide has to be dragged to count as a swipe. */
export function swipeThreshold(width: number): number {
  return Math.min(MAX_THRESHOLD_PX, Math.max(MIN_THRESHOLD_PX, width * 0.3));
}

/**
 * What letting go of a card dragged `dx` pixels sideways means: right is a
 * like, left a nope, and too short a drag is neither, so the card goes back.
 * A flick (`speed` in px/ms, signed like `dx`) counts before the threshold.
 */
export function verdictOf(dx: number, width: number, speed = 0): Verdict | null {
  const far = Math.abs(dx) >= swipeThreshold(width);
  const flicked = Math.abs(dx) >= FLICK_MIN_PX && Math.abs(speed) >= FLICK_SPEED && Math.sign(speed) === Math.sign(dx);
  if (!far && !flicked) return null;
  return dx > 0 ? "like" : "nope";
}

/** How far a dragged card leans, in degrees: a little, and never past 15. */
export function tiltOf(dx: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(-15, Math.min(15, (dx / width) * 18));
}

/** A radar that matched, and when, in milliseconds since the epoch. */
export interface Match {
  code: string;
  at: number;
}

/** Where the matches are kept, in the browser's localStorage and nowhere else. */
export const MATCHES_KEY = "meetYouCoolMatches";

/**
 * The matches as stored, newest first. Whatever does not parse is dropped,
 * and so is a radar `known` no longer knows (one taken off the map).
 */
export function parseMatches(raw: string | null | undefined, known: (code: string) => boolean): Match[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  let matches: Match[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { code, at } = item as Record<string, unknown>;
    if (typeof code !== "string" || !known(code)) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    matches = withMatch(matches, code, at);
  }
  return matches;
}

/** The matches with `code` added, newest first; a radar matched again moves to the top rather than twice. */
export function withMatch(matches: readonly Match[], code: string, at: number): Match[] {
  return [{ code, at }, ...matches.filter((match) => match.code !== code)].sort((a, b) => b.at - a.at);
}

/**
 * The matches kept in `storage`, or none. The getter is called inside the
 * try: a browser with storage switched off throws on merely asking for it.
 */
export function readMatches(storage: () => Pick<Storage, "getItem"> | null, known: (code: string) => boolean): Match[] {
  try {
    return parseMatches(storage()?.getItem(MATCHES_KEY), known);
  } catch {
    return [];
  }
}

/** Keeps the matches in `storage`; false where it could not (switched off, full). */
export function writeMatches(storage: () => Pick<Storage, "setItem"> | null, matches: readonly Match[]): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(MATCHES_KEY, JSON.stringify(matches));
    return true;
  } catch {
    return false;
  }
}

/** svelte-i18n's `$_`, or anything that answers the same way. */
export type Translate = (key: string, options?: { values?: Record<string, string | number> }) => string;

/** One of a profile's chips: what kind of fact it is, and how it reads. */
export interface Tag {
  kind: "operator" | "system" | "band" | "polarisation" | "tower" | "antenna" | "range";
  text: string;
}

/**
 * A radar's facts as chips, in the order a profile lists them. A fact
 * nobody could find is left out rather than guessed.
 */
export function tagsOf(info: RadarInfo, site: RadarSite | undefined, tr: Translate, num: (value: number) => string): Tag[] {
  const tags: Tag[] = [];
  if (info.operator) tags.push({ kind: "operator", text: info.operator });
  if (info.system) tags.push({ kind: "system", text: info.system });
  if (info.band) tags.push({ kind: "band", text: tr("meet.tag.band", { values: { band: info.band } }) });
  if (info.dualPol != null) tags.push({ kind: "polarisation", text: tr(info.dualPol ? "meet.tag.dual_pol" : "meet.tag.single_pol") });
  if (info.towerM) tags.push({ kind: "tower", text: tr("meet.tag.tower", { values: { height: num(info.towerM) } }) });
  if (site) tags.push({ kind: "antenna", text: tr("meet.tag.antenna", { values: { height: num(site.heightM) } }) });
  if (site?.rangeKm) tags.push({ kind: "range", text: tr("meet.tag.range", { values: { range: num(site.rangeKm) } }) });
  return tags;
}
