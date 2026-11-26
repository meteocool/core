/**
 * What a shared link's preview and a search result say about meteocool, in
 * every language the app speaks (src/locale/choose.ts). A share link names
 * the sender's language in `share_lang` (src/lib/shareLink.ts); English
 * otherwise. The motto stays English in all of them but French.
 *
 * Not typed by the app's locale list: choose.ts reads the page, which the
 * Worker's types have no window for. The tests hold the two to the same
 * languages.
 *
 * Kept free of Worker globals, so the tests can run it under Node.
 */

export interface PreviewCopy {
  /** OpenGraph's locale, language and territory. */
  locale: string;
  title: string;
  description: string;
}

export const PREVIEW_COPY: Record<string, PreviewCopy> = {
  en: {
    locale: "en_US",
    title: "meteocool – Live Rain Radar, Lightning & Storm Tracking",
    description:
      "Free 3D rain radar for Europe with live rain, lightning and storm cell tracking, plus super-accurate push notifications, column maximum, VIL, Echo Tops and much more. Open source since 2018, for iOS, Android and the web. Chase it or avoid it.",
  },
  de: {
    locale: "de_DE",
    title: "meteocool – Regenradar, Blitze & Unwetter live",
    description:
      "Freies 3D-Regenradar für Europa mit Regen, Blitzen und Unwetterzellen-Tracking in Echtzeit, dazu supergenaue Push-Benachrichtigungen, Säulenmaximum, VIL, Echotops und vieles mehr. Seit 2018 kostenlos und Open Source, für iOS, Android und das Web. Chase it or avoid it.",
  },
  fr: {
    locale: "fr_FR",
    title: "meteocool – radar de pluie, foudre et orages en direct",
    description:
      "Radar de pluie 3D gratuit pour l'Europe : pluie, foudre et suivi des cellules orageuses en temps réel, avec des notifications push ultra-précises, le maximum de colonne, le VIL, les sommets d'écho et bien plus. Open source depuis 2018, pour iOS, Android et le web. Chassez l'orage ou évitez-le.",
  },
  pl: {
    locale: "pl_PL",
    title: "meteocool – radar opadów, wyładowania i burze na żywo",
    description:
      "Darmowy radar opadów 3D dla Europy: opady, wyładowania i śledzenie komórek burzowych w czasie rzeczywistym, a do tego bardzo dokładne powiadomienia push, maksimum kolumny, VIL, wierzchołki echa i wiele więcej. Open source od 2018 roku, na iOS, Androida i w przeglądarce. Chase it or avoid it.",
  },
  nl: {
    locale: "nl_NL",
    title: "meteocool – live buienradar, bliksem en onweer",
    description:
      "Gratis 3D-buienradar voor Europa met live regen, bliksem en het volgen van onweerscellen, plus supernauwkeurige pushmeldingen, kolommaximum, VIL, echotoppen en nog veel meer. Open source sinds 2018, voor iOS, Android en het web. Chase it or avoid it.",
  },
  cs: {
    locale: "cs_CZ",
    title: "meteocool – srážkový radar, blesky a bouřky živě",
    description:
      "Bezplatný 3D srážkový radar pro Evropu: déšť, blesky a sledování bouřkových buněk v reálném čase, k tomu velmi přesná push oznámení, maximum sloupce, VIL, echotopy a mnohem více. Open source od roku 2018, pro iOS, Android a web. Chase it or avoid it.",
  },
  sk: {
    locale: "sk_SK",
    title: "meteocool – zrážkový radar, blesky a búrky naživo",
    description:
      "Bezplatný 3D zrážkový radar pre Európu: dážď, blesky a sledovanie búrkových buniek v reálnom čase, k tomu veľmi presné push notifikácie, maximum stĺpca, VIL, echotopy a oveľa viac. Open source od roku 2018, pre iOS, Android a web. Chase it or avoid it.",
  },
  lt: {
    locale: "lt_LT",
    title: "meteocool – kritulių radaras, žaibai ir audros realiu laiku",
    description:
      "Nemokamas 3D kritulių radaras Europai: lietus, žaibai ir audrų celių sekimas realiu laiku, taip pat itin tikslūs push pranešimai, stulpelio maksimumas, VIL, aido viršūnės ir dar daugiau. Atvirasis kodas nuo 2018 m., skirta iOS, Android ir žiniatinkliui. Chase it or avoid it.",
  },
  et: {
    locale: "et_EE",
    title: "meteocool – sademeradar, välk ja äike reaalajas",
    description:
      "Tasuta 3D-sademeradar Euroopale: vihm, välk ja äikeserakkude jälgimine reaalajas, lisaks ülitäpsed tõuketeavitused, sambamaksimum, VIL, kaja ülapiirid ja palju muud. Avatud lähtekoodiga alates 2018. aastast, iOS-ile, Androidile ja veebi. Chase it or avoid it.",
  },
  hr: {
    locale: "hr_HR",
    title: "meteocool – radar oborina, munje i oluje uživo",
    description:
      "Besplatni 3D radar oborina za Europu: kiša, munje i praćenje olujnih ćelija u stvarnom vremenu, uz to vrlo precizne push obavijesti, maksimum stupca, VIL, vrhovi odjeka i još mnogo toga. Otvoreni kod od 2018., za iOS, Android i web. Chase it or avoid it.",
  },
  da: {
    locale: "da_DK",
    title: "meteocool – live regnradar, lyn og uvejr",
    description:
      "Gratis 3D-regnradar for Europa med live regn, lyn og sporing af tordenceller, plus superpræcise push-notifikationer, søjlemaksimum, VIL, ekkotoppe og meget mere. Open source siden 2018, til iOS, Android og nettet. Chase it or avoid it.",
  },
  fi: {
    locale: "fi_FI",
    title: "meteocool – sadetutka, salamat ja ukkoset reaaliajassa",
    description:
      "Ilmainen 3D-sadetutka Euroopalle: sade, salamat ja ukkossolujen seuranta reaaliajassa, lisäksi erittäin tarkat push-ilmoitukset, pylväsmaksimi, VIL, kaikukorkeudet ja paljon muuta. Avointa lähdekoodia vuodesta 2018, iOS:lle, Androidille ja verkkoon. Chase it or avoid it.",
  },
  sv: {
    locale: "sv_SE",
    title: "meteocool – regnradar, blixtar och oväder live",
    description:
      "Gratis 3D-regnradar för Europa med regn, blixtar och spårning av åskceller i realtid, plus supernoggranna pushnotiser, kolumnmax, VIL, ekotoppar och mycket mer. Öppen källkod sedan 2018, för iOS, Android och webben. Chase it or avoid it.",
  },
  nb: {
    locale: "nb_NO",
    title: "meteocool – nedbørsradar, lyn og uvær i sanntid",
    description:
      "Gratis 3D-nedbørsradar for Europa med regn, lyn og sporing av tordenceller i sanntid, pluss svært presise push-varsler, kolonnemaks, VIL, ekkotopper og mye mer. Åpen kildekode siden 2018, for iOS, Android og nettet. Chase it or avoid it.",
  },
};

/** Older systems' names for Norwegian, which is written in Bokmål here (as in choose.ts). */
const ALIASES: Record<string, string> = { no: "nb", nn: "nb" };

/** The copy for a `share_lang`, English for none or one the app does not speak. */
export function previewCopy(lang: string | null): PreviewCopy {
  const subtag = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0];
  const language = Object.hasOwn(ALIASES, subtag) ? ALIASES[subtag] : subtag;
  // Own keys only: `share_lang=constructor` is a URL anyone can send.
  return Object.hasOwn(PREVIEW_COPY, language) ? PREVIEW_COPY[language] : PREVIEW_COPY.en;
}

/** The other languages' OpenGraph locales, its alternates. */
export function alternateLocales(copy: PreviewCopy): string[] {
  return Object.values(PREVIEW_COPY).map((other) => other.locale).filter((locale) => locale !== copy.locale);
}
