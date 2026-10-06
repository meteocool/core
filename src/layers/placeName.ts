import type { FeatureLike } from "ol/Feature";

/**
 * The properties a place's name is read from, first choice first: the
 * locale's language, English, then the local name. Resolved once per locale;
 * the 3D map builds its label expression from the same list.
 */
export function placeNameKeys(locale: string | null): string[] {
  let language = "en";
  try {
    const parsed = new Intl.Locale(locale || "en");
    language = parsed.language === "zh" ? `zh-${parsed.maximize().script}` : parsed.language;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return [`name:${language}`, "name:en", "name"];
}

/** Resolve locale keys once; translation availability is checked for each place. */
export function placeNameForLocale(locale: string | null) {
  const keys = placeNameKeys(locale);
  return (feature: FeatureLike): string | undefined =>
    keys.map((key) => feature.get(key))
      .find((name): name is string => typeof name === "string" && name.trim().length > 0);
}
