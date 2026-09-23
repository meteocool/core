import type { FeatureLike } from "ol/Feature";

/** Resolve locale keys once; translation availability is checked for each place. */
export function placeNameForLocale(locale: string | null) {
  let language = "en";
  try {
    const parsed = new Intl.Locale(locale || "en");
    language = parsed.language === "zh" ? `zh-${parsed.maximize().script}` : parsed.language;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return (feature: FeatureLike): string | undefined =>
    [feature.get(`name:${language}`), feature.get("name:en"), feature.get("name")]
      .find((name): name is string => typeof name === "string" && name.trim().length > 0);
}
