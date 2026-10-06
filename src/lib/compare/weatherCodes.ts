/** WMO weather codes, as open-meteo returns them, with meteocool's pictograms. */

import type { Translate } from "../../locale/t";

export interface WeatherCode {
  label: string;
  icon: string;
}

/* The pictograms only; each code's label is `compare.weather.<code>`. */
const ICONS: Record<number, string> = {
  0: "☀️",
  1: "🌤",
  2: "⛅️",
  3: "☁️",
  45: "🌫",
  48: "🌫",
  51: "🌦",
  53: "🌦",
  55: "🌦",
  56: "🌧",
  57: "🌧",
  61: "🌦",
  63: "🌧",
  65: "🌧",
  66: "🌧",
  67: "🌧",
  71: "🌨",
  73: "🌨",
  75: "❄️",
  77: "🌨",
  80: "🌦",
  81: "🌧",
  82: "⛈",
  85: "🌨",
  86: "❄️",
  95: "⛈",
  96: "⛈",
  99: "⛈",
};

const UNKNOWN: WeatherCode = { label: "—", icon: "•" };

/** Takes the component's `$_`, so the label follows a language change. */
export function weatherCode(code: number | null, t: Translate): WeatherCode {
  if (code === null) return UNKNOWN;
  const known = Math.round(code);
  const icon = ICONS[known];
  if (!icon) return UNKNOWN;
  return { label: t(`compare.weather.${known}`), icon };
}
