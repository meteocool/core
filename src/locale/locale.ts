import { getLocaleFromNavigator } from "svelte-i18n";
import { de, enUS } from "date-fns/locale";

/** The date-fns locale matching the browser's, falling back to English. */
export default function getDfnLocale() {
  const loc = (getLocaleFromNavigator() ?? "en").split("-")[0];
  if (loc === "de") {
    return de;
  }
  return enUS;
}
