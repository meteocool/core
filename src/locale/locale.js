import { getLocaleFromNavigator } from "svelte-i18n";
import { de, enUS } from "date-fns/locale";

export default function getDfnLocale() {
  const loc = getLocaleFromNavigator().split("-")[0];
  if (loc === "de") {
    return de;
  }
  return enUS;
}
