import type { components } from "../api/generated/data";
import { toKnots } from "./windBarb";

/**
 * What the weather stations over the radar map decide, apart from drawing
 * them: whether they are shown, which parameter a choice asks for, which
 * time to ask about, what a station's value reads as, and which stations are
 * left when they crowd.
 *
 * Pure: lib/StationManager.ts and layers/stations.ts are the plumbing.
 */

/** What one station reported, as `/stations/observations` answers it. */
export type ObservedProperties = components["schemas"]["ObservedProperties"];

/** A parameter `/stations/observations?parameter=` takes: every optional number a station can report. */
export type StationParameter = {
  [K in keyof ObservedProperties]-?: NonNullable<ObservedProperties[K]> extends number ? K : never
}[keyof ObservedProperties];

/** The one parameter the map shows at a time. */
export type StationChoice = "wind" | "gusts" | "temperature" | "precipitation" | "humidity" | "pressure";

/** The choices, in the order the control offers them. Wind first: it is the default. */
export const STATION_CHOICES: readonly StationChoice[] = [
  "wind", "gusts", "temperature", "precipitation", "humidity", "pressure",
];

export const DEFAULT_STATION_CHOICE: StationChoice = "wind";

/** How often the stations are asked for again while they are shown: DWD publishes every ten minutes. */
export const STATIONS_REFRESH_MS = 5 * 60 * 1000;

/**
 * How old a station's value may be and still be drawn. DWD publishes a
 * series 20 to 60 minutes after its ten minutes end, a series at a time, so
 * the service's own hour often holds none of a series: at 02:50 the newest
 * temperature was from 01:50, and the map was empty. An hour and a half
 * covers that and the ingest's poll, and no more.
 */
export const STATIONS_MAX_AGE_MINUTES = 90;

/** How long the timeline has to rest on a frame before the stations for it are asked for. */
export const STATIONS_SCRUB_DEBOUNCE_MS = 400;

const PARAMETERS: Record<StationChoice, readonly StationParameter[]> = {
  wind: ["wind_speed_m_s", "wind_direction_deg"],
  gusts: ["gust_m_s", "gust_direction_deg"],
  temperature: ["temperature_c"],
  precipitation: ["precipitation_mm"],
  humidity: ["humidity_pct"],
  pressure: ["pressure_msl_hpa"],
};

/** A stored choice, or the default for anything that is not one. */
export function parseStationChoice(value: unknown): StationChoice {
  return STATION_CHOICES.includes(value as StationChoice) ? (value as StationChoice) : DEFAULT_STATION_CHOICE;
}

/**
 * Whether the stations drawn are greyed: the timeline is on a forecast
 * frame, past the newest observation, which no station has measured. They
 * stay on the map, the newest of them, faint and without their colours, so
 * the reader scrubbing ahead keeps them and is not told they are the
 * frame's. Zero is a timeline with no grid yet.
 */
export function stationsStale(shown: number, newest: number): boolean {
  return shown > 0 && newest > 0 && shown > newest;
}

/**
 * Whether the stations are drawn and asked for: switched on, and on the
 * radar map, the one they lie over. Not behind another map.
 */
export function stationsShown(on: boolean, capability: string): boolean {
  return on && capability === "radar";
}

/** What a choice asks for, and nothing else: everything at once is five times the bytes. */
export function parametersFor(choice: StationChoice): StationParameter[] {
  return [...PARAMETERS[choice]];
}

/** Whether a choice is drawn as wind barbs rather than a number. */
export const isWind = (choice: StationChoice): boolean => choice === "wind" || choice === "gusts";

/**
 * The time to ask about, or null for the newest.
 *
 * `shown` and `newest` are the timeline's frame and its newest observation,
 * epoch seconds (`capTimeIndicator`, `capLatestObservation`). On an observed
 * frame in the past the stations are the ones from then, so they match the
 * radar; live, and on a forecast frame, which no station has measured yet,
 * they are the newest. Zero is a timeline with no grid yet.
 */
export function stationsAt(shown: number, newest: number): Date | null {
  if (shown <= 0 || newest <= 0 || shown >= newest) return null;
  return new Date(shown * 1000);
}

/** A station's wind for a barb, in knots, or null when it reported none. */
export function windOf(choice: StationChoice, station: ObservedProperties): { knots: number; fromDeg: number } | null {
  const speed = choice === "gusts" ? station.gust_m_s : station.wind_speed_m_s;
  const from = choice === "gusts" ? station.gust_direction_deg : station.wind_direction_deg;
  if (typeof speed !== "number" || typeof from !== "number") return null;
  return { knots: toKnots(speed), fromDeg: from };
}

/** The number a station shows for a choice drawn as one, or null when it reported none. */
export function valueOf(choice: StationChoice, station: ObservedProperties): number | null {
  if (isWind(choice)) return null;
  const value = station[PARAMETERS[choice][0]];
  return typeof value === "number" ? value : null;
}

/**
 * A number with `digits` decimals as the reader's language writes it: 7,3 in
 * German, 7.3 in English. Never grouped, so a pressure is 1013,0 and not
 * 1.013,0, which reads as one hectopascal.
 */
export function formatNumber(value: number, digits: number, lang = "en"): string {
  // `|| 0`: -0.04 °C is written 0.0, not -0.0.
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits || 0;
  return new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
    .format(rounded);
}

/** A value as the map writes it: whole percent for humidity, one decimal for the rest. */
export function formatValue(choice: StationChoice, value: number, lang = "en"): string {
  return formatNumber(value, choice === "humidity" ? 0 : 1, lang);
}

/**
 * The colour a temperature is written in, by band: violet in hard frost,
 * blue below zero, green to ten, yellow to twenty, orange to thirty, red above.
 */
export function temperatureColour(celsius: number): string {
  if (celsius < -10) return "#c4b5fd";
  if (celsius < 0) return "#7dd3fc";
  if (celsius < 10) return "#86efac";
  if (celsius < 20) return "#fde047";
  if (celsius < 30) return "#fdba74";
  return "#fca5a5";
}

/**
 * The reflectivity ten minutes' rain would show on the radar, so a gauge is
 * coloured in the palette the radar is: the rate in mm/h, through
 * Marshall-Palmer (Z = 200 R^1.6). Null for none, and for a trace that
 * would be written 0.0: drawn as a dry gauge rather than a number saying nothing.
 */
export function precipitationDbz(millimetres: number): number | null {
  if (!(millimetres >= 0.05)) return null;
  const rate = millimetres * 6;
  return 10 * Math.log10(200 * rate ** 1.6);
}

/**
 * How big a screen-space cell holds one station, in pixels: none from zoom 8
 * in, where every station has room, and about a barb's reach further out.
 */
export function thinningCell(zoom: number): number {
  return zoom >= 8 ? 0 : 44;
}

/** Web Mercator metres per pixel at a zoom: the map's resolution there. */
export function resolutionAt(zoom: number): number {
  return 156543.03392804097 / 2 ** zoom;
}

/** A station where it lands on screen, in the map's pixels, and how much it matters among its neighbours. */
export interface PlacedStation {
  id: string;
  x: number;
  y: number;
  /** Higher wins a cell: a gauge with rain over one without. */
  rank: number;
}

/**
 * The stations left when the map is thinned to one per `cell` pixels: the
 * highest ranked in each cell, and among equals the one nearest its middle,
 * so the ones left are spread evenly. Every one for a cell of 0.
 *
 * `x` and `y` are best world pixels (map units over the resolution), so the
 * grid stays put while the map pans and the same stations stay.
 */
export function thinToGrid(stations: PlacedStation[], cell: number): Set<string> {
  if (cell <= 0) return new Set(stations.map((station) => station.id));
  const best = new Map<string, { station: PlacedStation; offset: number }>();
  for (const station of stations) {
    const column = Math.floor(station.x / cell);
    const row = Math.floor(station.y / cell);
    const offset = Math.hypot(station.x - (column + 0.5) * cell, station.y - (row + 0.5) * cell);
    const key = `${column}:${row}`;
    const held = best.get(key);
    if (!held || station.rank > held.station.rank || (station.rank === held.station.rank && offset < held.offset)) {
      best.set(key, { station, offset });
    }
  }
  return new Set([...best.values()].map(({ station }) => station.id));
}
