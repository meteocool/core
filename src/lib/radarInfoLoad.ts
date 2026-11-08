import {
  infoFileOf, textFileOf, textLanguage, withTexts,
  type RadarFactsFile, type RadarInfo, type RadarInfoFile, type RadarTextFile,
} from "./radarInfo";
import { siteCode } from "./radarSites";

/*
 * A chunk per country for the facts, and one per language and country for
 * the texts, each fetched on first use: a lazy glob is a dynamic import per
 * file, so none of it is in the app's own bundle, and a reader fetches the
 * texts of their own language and English, never all fourteen.
 */
const factFiles = import.meta.glob<RadarFactsFile>("../radarInfo/radar-info-*.json", { import: "default" });
const textFiles = import.meta.glob<RadarTextFile>("../radarInfo/text/radar-text-*.json", { import: "default" });

/** English, which stands in for a text not yet translated, and the reader's language. */
function languagesFor(locale: string | null | undefined): string[] {
  const language = textLanguage(locale);
  return language === "en" ? ["en"] : ["en", language];
}

/** One country's texts in each of `languages` that has a file, by language. */
async function textsOf(code: string, languages: string[]): Promise<Record<string, RadarTextFile>> {
  const loaded = await Promise.all(languages.map(async (language) => {
    const load = textFiles[`../radarInfo/text/${textFileOf(code, language)}.json`];
    return [language, load ? await load() : {}] as const;
  }));
  return Object.fromEntries(loaded);
}

/** What there is to say about a radar, in the reader's language, or null for one with no entry. Rejects when a chunk will not load. */
export async function loadRadarInfo(code: string, locale?: string | null): Promise<RadarInfo | null> {
  const site = siteCode(code);
  const load = factFiles[`../radarInfo/${infoFileOf(site)}.json`];
  if (!load) return null;
  const [facts, texts] = await Promise.all([load(), textsOf(site, languagesFor(locale))]);
  return facts[site] ? withTexts(site, facts[site], texts) : null;
}

/**
 * Every radar there is something to say about, by node code, in the
 * reader's language: every country's chunks at once, for "meet you cool",
 * which deals them all. Rejects when one of them will not load.
 */
export async function loadAllRadarInfo(locale?: string | null): Promise<RadarInfoFile> {
  const languages = languagesFor(locale);
  const countries = await Promise.all(Object.values(factFiles).map(async (load) => {
    const facts = await load();
    const first = Object.keys(facts)[0];
    const texts = first ? await textsOf(first, languages) : {};
    return Object.fromEntries(Object.entries(facts).map(([code, entry]) => [code, withTexts(code, entry, texts)]));
  }));
  return Object.assign({}, ...countries) as RadarInfoFile;
}
