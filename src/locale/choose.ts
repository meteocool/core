/**
 * Which language the frontend speaks: the app's, when it says, else the
 * browser's.
 *
 * The iOS and Android apps are localised in English and German; this reads
 * French, Polish, Dutch, Czech and Slovak as well (see i18n.ts). Their web
 * view does not reliably report the app's language -- a per-app language
 * setting on iOS does not reach `navigator.language` everywhere, and neither
 * app sets an Accept-Language -- so an app can say it outright, and that wins:
 *
 *   - `?lang=de` on the page's URL, for the app that builds the URL, or
 *   - `window.settings.injectSettings({ lang: "de" })`, like every other
 *     setting the apps push; stored, so the next launch starts in it.
 *
 * Failing both, the browser's own list, in its order of preference: the
 * first language we have wins, so a reader with de-AT ahead of en-GB gets
 * German. English otherwise.
 *
 * Pure but for the defaults, which read the page: the tests hand it the
 * three sources.
 */
export const LOCALES = ["en", "de", "fr", "pl", "nl", "cs", "sk"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** The storage key, shared with the `lang` setting in App.svelte. */
export const LANG_KEY = "lang";

/** "de-AT", "de_DE", "DE" -> "de"; null for a language we do not have. */
export function normaliseLocale(tag: string | null | undefined): AppLocale | null {
  const language = String(tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(language) ? (language as AppLocale) : null;
}

interface Sources {
  /** `?lang=` on the page URL. */
  url?: string | null;
  /** What the app injected last, as stored. */
  app?: string | null;
  /** The browser's preference list. */
  browser?: readonly string[];
}

function pageSources(): Sources {
  let url: string | null = null;
  let app: string | null = null;
  try {
    url = new URL(window.location.href).searchParams.get(LANG_KEY);
  } catch { /* no location: not a page */ }
  try {
    app = localStorage.getItem(LANG_KEY);
  } catch { /* storage blocked */ }
  const browser = typeof navigator === "undefined"
    ? []
    : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  return { url, app, browser };
}

export function chooseLocale(sources: Sources = pageSources()): AppLocale {
  return normaliseLocale(sources.url)
    ?? normaliseLocale(sources.app)
    ?? (sources.browser ?? []).map(normaliseLocale).find((l): l is AppLocale => l !== null)
    ?? "en";
}
