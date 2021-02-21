import { getLocaleFromNavigator } from "svelte-i18n";
import { de, enUS } from "date-fns/locale";

export default function getDfnLocale() {
  if (getLocaleFromNavigator() === "de") {
    return de;
  }
  return enUS;
}
