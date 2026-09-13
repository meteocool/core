/** WMO weather codes, as open-meteo returns them, with meteocool's pictograms. */

export interface WeatherCode {
  label: string;
  icon: string;
}

const CODES: Record<number, WeatherCode> = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤" },
  2: { label: "Partly cloudy", icon: "⛅️" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫" },
  48: { label: "Rime fog", icon: "🌫" },
  51: { label: "Light drizzle", icon: "🌦" },
  53: { label: "Drizzle", icon: "🌦" },
  55: { label: "Heavy drizzle", icon: "🌦" },
  56: { label: "Freezing drizzle", icon: "🌧" },
  57: { label: "Freezing drizzle", icon: "🌧" },
  61: { label: "Light rain", icon: "🌦" },
  63: { label: "Rain", icon: "🌧" },
  65: { label: "Heavy rain", icon: "🌧" },
  66: { label: "Freezing rain", icon: "🌧" },
  67: { label: "Freezing rain", icon: "🌧" },
  71: { label: "Light snow", icon: "🌨" },
  73: { label: "Snow", icon: "🌨" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨" },
  80: { label: "Light showers", icon: "🌦" },
  81: { label: "Showers", icon: "🌧" },
  82: { label: "Violent showers", icon: "⛈" },
  85: { label: "Snow showers", icon: "🌨" },
  86: { label: "Heavy snow showers", icon: "❄️" },
  95: { label: "Thunderstorm", icon: "⛈" },
  96: { label: "Thunderstorm, hail", icon: "⛈" },
  99: { label: "Thunderstorm, heavy hail", icon: "⛈" },
};

const UNKNOWN: WeatherCode = { label: "—", icon: "•" };

export function weatherCode(code: number | null): WeatherCode {
  if (code === null) return UNKNOWN;
  return CODES[Math.round(code)] ?? UNKNOWN;
}
