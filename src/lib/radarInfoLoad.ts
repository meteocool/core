import { infoFileOf, type RadarInfo, type RadarInfoFile } from "./radarInfo";
import { siteCode } from "./radarSites";

/*
 * One chunk per country, fetched on first use: a lazy glob is a dynamic
 * import per file, so none of the texts is in the app's own bundle.
 */
const files = import.meta.glob<RadarInfoFile>("../radarInfo/*.json", { import: "default" });

/** What there is to say about a radar, or null for one with no entry. Rejects when the chunk will not load. */
export async function loadRadarInfo(code: string): Promise<RadarInfo | null> {
  const site = siteCode(code);
  const load = files[`../radarInfo/${infoFileOf(site)}.json`];
  if (!load) return null;
  return (await load())[site] ?? null;
}

/**
 * Every radar there is something to say about, by node code: every country's
 * chunk at once, for "meet you cool", which deals them all. Rejects when one
 * of them will not load.
 */
export async function loadAllRadarInfo(): Promise<RadarInfoFile> {
  const countries = await Promise.all(Object.values(files).map((load) => load()));
  return Object.assign({}, ...countries) as RadarInfoFile;
}
