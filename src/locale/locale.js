import { getLocaleFromNavigator } from 'svelte-i18n';
import { de, enUS } from 'date-fns/locale';

export function getDfnLocale() {
  if (getLocaleFromNavigator() === "de") {
    return de;
  } else {
    return enUS;
  }
}
