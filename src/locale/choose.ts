/**
 * Which language the frontend speaks: the browser's (in the apps, the web
 * view's, which is the phone's system language).
 *
 * Its preference list is read in order and the first language we have wins,
 * so a reader with de-AT ahead of en-GB gets German. English otherwise.
 * `?lang=de` on the URL overrides it, for links and for checking a
 * translation without changing the system language.
 *
 * Pure but for the defaults, which read the page: the tests hand it the
 * sources.
 */
export const LOCALES = ["en", "de", "fr", "pl", "nl", "cs", "sk"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** The URL parameter that overrides the browser's language. */
export const LANG_KEY = "lang";

/** "de-AT", "de_DE", "DE" -> "de"; null for a language we do not have. */
export function normaliseLocale(tag: string | null | undefined): AppLocale | null {
  const language = String(tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(language) ? (language as AppLocale) : null;
}

interface Sources {
  /** `?lang=` on the page URL. */
  url?: string | null;
  /** The browser's preference list. */
  browser?: readonly string[];
}

function pageSources(): Sources {
  let url: string | null = null;
  try {
    url = new URL(window.location.href).searchParams.get(LANG_KEY);
  } catch { /* no location: not a page */ }
  const browser = typeof navigator === "undefined"
    ? []
    : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  return { url, browser };
}

export function chooseLocale(sources: Sources = pageSources()): AppLocale {
  return normaliseLocale(sources.url)
    ?? (sources.browser ?? []).map(normaliseLocale).find((l): l is AppLocale => l !== null)
    ?? "en";
}
