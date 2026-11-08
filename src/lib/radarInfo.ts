/**
 * What a reader is told about one radar when they ask: a photo, a few lines
 * on where it stands and what it watches, and the facts of the instrument.
 *
 * The texts are a file per country under `src/radarInfo/`, each a chunk of
 * its own fetched only when a radar of that country is asked about
 * (radarInfoLoad.ts), and the photos are under `public/radars/`; neither is
 * in the first load nor in the service worker's precache (vite.config.ts).
 * The photos are under free licences only (CC0, CC BY, CC BY-SA, open
 * government licences), from Wikimedia Commons and from Flickr, Geograph and
 * the like where Commons had none, resized; each says whose it is, under
 * which licence, and links to where it came from. Where a fact could not be
 * found it is null and left out, rather than guessed.
 *
 * The prose is in English and German; every other language reads the
 * English. The facts are drawn in the reader's language from the labels.
 */

import { countryOf } from "./radarSites";

export interface RadarPhoto {
  /** Under `public/radars/`, as the page fetches it. */
  src: string;
  width: number;
  height: number;
  /** Whose photo it is, as its page credits it. */
  author: string;
  /** The licence's short name: "CC BY-SA 4.0", "Public domain". */
  licence: string;
  licenceUrl: string | null;
  /** The photo's own page where it was published: Commons, Flickr, Geograph. */
  page: string;
}

export interface RadarInfo {
  /** Who runs it: the met service's own short name. */
  operator: string | null;
  /** Its maker and model. */
  system: string | null;
  band: "C" | "S" | "X" | null;
  dualPol: boolean | null;
  /** The year the radar now there went into service, as a reader writes it. */
  since: string | null;
  towerM: number | null;
  /** Where it stands and what it watches, a few sentences long. */
  text: { en: string; de?: string };
  photo: RadarPhoto | null;
  /** Where the text and the facts come from, as links; the photo credits its own page. */
  sources: string[];
}

/** A country's file of radars, by node code. */
export type RadarInfoFile = Record<string, RadarInfo>;

/** The texts' languages besides English, which every other language falls back to. */
const LANGUAGES = ["de"] as const;

/** The description in the reader's language, or in English where there is none in theirs. */
export function infoText(info: RadarInfo, locale: string | null | undefined): string {
  const language = (locale ?? "en").slice(0, 2).toLowerCase();
  const own = (LANGUAGES as readonly string[]).includes(language)
    ? info.text[language as (typeof LANGUAGES)[number]]
    : undefined;
  return own || info.text.en;
}

/** The name of the file a radar's texts are in, by its node code. */
export function infoFileOf(code: string): string {
  return `radar-info-${countryOf(code)}`;
}

/** Sources that turn up for many radars, by the name a reader knows them by. */
const SOURCE_NAMES: Array<[RegExp, string]> = [
  [/(^|\.)wrd\.mgm\.gov\.tr$/, "WMO Weather Radar Database"],
  [/(^|\.)eumetnet\.eu$/, "EUMETNET OPERA"],
  [/(^|\.)dwd\.de$/, "DWD"],
  [/(^|\.)(ilmatieteenlaitos\.fi|fmi\.fi)$/, "FMI"],
  [/(^|\.)(meteoswiss|meteosuisse)\.admin\.ch$/, "MeteoSwiss"],
  [/(^|\.)meteofrance\.(com|fr)$/, "Météo-France"],
  [/(^|\.)smhi\.se$/, "SMHI"],
  [/(^|\.)met\.no$/, "MET Norway"],
  [/(^|\.)snl\.no$/, "Store norske leksikon"],
  [/(^|\.)meteo\.be$/, "RMI"],
  [/(^|\.)knmi\.nl$/, "KNMI"],
  [/(^|\.)dmi\.dk$/, "DMI"],
  [/(^|\.)met\.ie$/, "Met Éireann"],
  [/(^|\.)imgw\.pl$/, "IMGW"],
  [/(^|\.)chmi\.cz$/, "ČHMÚ"],
  [/(^|\.)meteo\.lt$/, "LHMT"],
  [/(^|\.)meteohmd\.hr$/, "DHMZ"],
  [/(^|\.)ted\.europa\.eu$/, "EU tenders (TED)"],
  [/(^|\.)wikidata\.org$/, "Wikidata"],
];

/**
 * What a source link says: the name of whoever published it where it is a
 * known one ("DWD", "Wikipedia (de)"), its site's address otherwise. Two
 * links to the same publisher are told apart by a number.
 */
export function sourceLabels(urls: readonly string[]): string[] {
  const names = urls.map((url) => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return url;
    }
    const wiki = /^([a-z-]+)\.(wikipedia|wikiversity)\.org$/.exec(host);
    if (wiki) return `${wiki[2] === "wikipedia" ? "Wikipedia" : "Wikiversity"} (${wiki[1]})`;
    return SOURCE_NAMES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, "");
  });
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const name of names) total.set(name, (total.get(name) ?? 0) + 1);
  return names.map((name) => {
    if ((total.get(name) ?? 0) < 2) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
}
