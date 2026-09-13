/**
 * Typed client for open-meteo's multi-model forecast endpoint.
 *
 * meteocompare has no backend of its own: it is a frontend that reads
 * open-meteo directly, which is free, unauthenticated and CORS-open. This
 * talks to the same endpoint with the same shape, so the comparison here is
 * the comparison meteocompare makes.
 *
 * Docs: https://open-meteo.com/en/docs
 */
import { MODEL_IDS } from "./models";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** open-meteo suffixes every per-model column with the model id. */
const DAILY_VARS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
] as const;

export type DailyVar = (typeof DAILY_VARS)[number];

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  utc_offset_seconds: number;
  timezone: string;
  daily: { time: string[] } & Partial<Record<string, (number | null)[]>>;
  daily_units: Record<string, string>;
}

export interface ForecastRequest {
  lat: number;
  lon: number;
  models?: string[];
  forecastDays?: number;
  signal?: AbortSignal;
}

/**
 * One variable's values for one day, per model, with the models that had
 * nothing to say left out entirely rather than carried as nulls.
 */
export type PerModel = Record<string, number>;

export interface DailyForecast {
  /** ISO date, local to the queried point. */
  date: string;
  values: Record<DailyVar, PerModel>;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  units: Record<string, string>;
  days: DailyForecast[];
  /** Models that returned at least one value; the rest do not cover this point. */
  respondingModels: string[];
}

export async function fetchForecast(req: ForecastRequest): Promise<Forecast> {
  const models = req.models ?? MODEL_IDS;
  const params = new URLSearchParams({
    latitude: String(req.lat),
    longitude: String(req.lon),
    daily: DAILY_VARS.join(","),
    models: models.join(","),
    forecast_days: String(req.forecastDays ?? 7),
    timezone: "auto",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });

  const response = await fetch(`${FORECAST_URL}?${params}`, { signal: req.signal });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`open-meteo ${response.status}: ${body || response.statusText}`);
  }
  const raw = (await response.json()) as ForecastResponse;
  return shape(raw, models);
}

/** Turn open-meteo's `<var>_<model>` columns into per-day, per-model values. */
function shape(raw: ForecastResponse, models: string[]): Forecast {
  const responding = new Set<string>();

  const days: DailyForecast[] = raw.daily.time.map((date, index) => {
    const values = {} as Record<DailyVar, PerModel>;
    for (const variable of DAILY_VARS) {
      const perModel: PerModel = {};
      for (const id of models) {
        const column = raw.daily[`${variable}_${id}`];
        const value = column?.[index];
        // A model that does not cover this point returns nulls throughout;
        // dropping it here is what keeps it out of the consensus and out of
        // the effective model count.
        if (typeof value === "number" && Number.isFinite(value)) {
          perModel[id] = value;
          responding.add(id);
        }
      }
      values[variable] = perModel;
    }
    return { date, values };
  });

  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    elevation: raw.elevation,
    timezone: raw.timezone,
    units: raw.daily_units,
    days,
    respondingModels: models.filter((id) => responding.has(id)),
  };
}
