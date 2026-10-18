import { enUS } from "date-fns/locale/en-US";
import type { Locale } from "date-fns";
import { get } from "svelte/store";
import { locale } from "svelte-i18n";
import { normaliseLocale, type AppLocale } from "./choose";

/**
 * The date-fns locale for the frontend's language (see choose.ts).
 *
 * English is in the bundle; every other one is fetched when it is the one
 * chosen, as the message catalogues are (i18n.ts), so a reader in English
 * downloads none of them. Until it lands the English one answers, and the
 * next render (LastUpdated re-formats every ten seconds) picks it up.
 */
const LOADERS: Record<Exclude<AppLocale, "en">, () => Promise<Locale>> = {
  de: () => import("date-fns/locale/de").then((m) => m.de),
  fr: () => import("date-fns/locale/fr").then((m) => m.fr),
  pl: () => import("date-fns/locale/pl").then((m) => m.pl),
  nl: () => import("date-fns/locale/nl").then((m) => m.nl),
  cs: () => import("date-fns/locale/cs").then((m) => m.cs),
  sk: () => import("date-fns/locale/sk").then((m) => m.sk),
  lt: () => import("date-fns/locale/lt").then((m) => m.lt),
  et: () => import("date-fns/locale/et").then((m) => m.et),
  hr: () => import("date-fns/locale/hr").then((m) => m.hr),
  da: () => import("date-fns/locale/da").then((m) => m.da),
  fi: () => import("date-fns/locale/fi").then((m) => m.fi),
  sv: () => import("date-fns/locale/sv").then((m) => m.sv),
  nb: () => import("date-fns/locale/nb").then((m) => m.nb),
};

let current: Locale = enUS;

locale.subscribe((tag) => {
  const wanted = normaliseLocale(tag);
  if (!wanted || wanted === "en") {
    current = enUS;
    return;
  }
  LOADERS[wanted]().then((loaded) => {
    // Another language chosen while this one was on its way.
    if (normaliseLocale(get(locale)) === wanted) current = loaded;
  }).catch(() => { /* offline: English dates, which is what there was */ });
});

export default function getDfnLocale(): Locale {
  return current;
}
