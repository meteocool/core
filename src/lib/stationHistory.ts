import type { components } from "../api/generated/data";

/**
 * What a weather station measured over the last day, three or seven, as the
 * panels of its sheet show it (StationHistory): a meteogram of small
 * multiples over one clock.
 *
 * Each panel is one quantity with what summarises it written under its
 * name: the highest and lowest temperature, the rain that fell, the hours
 * of sunshine, the strongest gust. A panel is left out where the station
 * does not measure it; a quantity measured and always zero (a dry week) is
 * kept, because "none fell" is the answer.
 *
 * Pure: the component fetches and draws.
 */

/** One ten-minute row, as `/stations/{station}/observations` answers it. */
export type ObservationRow = components["schemas"]["ObservationRow"];

/** How far back the panels go. A week is as much as the service holds. */
export type HistoryWindow = "day" | "three_days" | "week";

export const HISTORY_WINDOWS: readonly HistoryWindow[] = ["day", "three_days", "week"];

const WINDOW_HOURS: Record<HistoryWindow, number> = { day: 24, three_days: 72, week: 168 };

const HOUR = 3_600_000;

/** Where a window starts, `now` being epoch milliseconds. */
export function windowStart(window: HistoryWindow, now: number): number {
  return now - WINDOW_HOURS[window] * HOUR;
}

/**
 * A row further from the one before than this has a gap before it: DWD's
 * rows are ten minutes apart, and a line across a quiet station would draw
 * values nobody measured. Three missed rows, so one late file is no gap.
 */
export const MAX_GAP_MS = 40 * 60_000;

/** One reading of a series: its time, epoch milliseconds, and its value. */
export interface Point {
  t: number;
  v: number | null;
}

/**
 * How a series is drawn: `main` the panel's own line in its colour,
 * `context` a second quantity in plain ink (the dew point under the
 * temperature, the gusts over the mean wind), `bars` ten minutes' amounts,
 * and `dots` a direction, which has no line between two readings.
 */
export type SeriesStyle = "main" | "context" | "bars" | "dots";

export interface Series {
  key: string;
  style: SeriesStyle;
  points: Point[];
}

/** A summary beside the caption: which (a key under `stations.history.stat`) and its value, in the panel's unit. */
export interface Stat {
  key: "max" | "min" | "mean" | "total" | "change" | "gust";
  value: number;
}

export type PanelKey = "temperature" | "precipitation" | "sunshine" | "humidity" | "pressure" | "wind" | "direction";

export interface HistoryPanel {
  key: PanelKey;
  unit: string;
  /** Decimals a value is written with. */
  digits: number;
  series: Series[];
  stats: Stat[];
  /**
   * A range the panel's scale is fixed to, with its ticks, rather than one
   * read off the values; `floor` instead keeps the bottom at zero and the top
   * at least that, so a few tenths of a millimetre are not drawn as a flood.
   */
  fixed?: { min: number; max: number; ticks: number[] };
  floor?: number;
}

type Numeric = {
  [K in keyof ObservationRow]-?: NonNullable<ObservationRow[K]> extends number ? K : never
}[keyof ObservationRow];

const pointsOf = (rows: ObservationRow[], key: Numeric): Point[] => rows.map((row) => ({
  t: Date.parse(row.observed_at),
  v: typeof row[key] === "number" ? row[key] as number : null,
}));

const valuesOf = (points: Point[]): number[] => points.flatMap((point) => (point.v === null ? [] : [point.v]));

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]): number => sum(values) / values.length;

/**
 * The extremes from DWD's own ten-minute extremes where it publishes them
 * (`temperature_max_c`, the highest in the ten minutes), else from the
 * readings: a peak between two readings is still the day's maximum.
 */
const extreme = (pick: (values: number[]) => number, ...series: number[][]) => {
  const values = series.find((candidate) => candidate.length) ?? [];
  return values.length ? pick(values) : null;
};

const stat = (key: Stat["key"], value: number | null): Stat[] => (value === null ? [] : [{ key, value }]);

/** The panels a station's rows fill, in the order they are stacked; none for no rows. */
export function historyPanels(rows: ObservationRow[]): HistoryPanel[] {
  if (!rows.length) return [];
  const panels: HistoryPanel[] = [];

  const temperature = pointsOf(rows, "temperature_c");
  const temperatures = valuesOf(temperature);
  if (temperatures.length) {
    panels.push({
      key: "temperature",
      unit: "°C",
      digits: 1,
      series: [
        { key: "dew_point", style: "context", points: pointsOf(rows, "dew_point_c") },
        { key: "temperature", style: "main", points: temperature },
      ],
      stats: [
        ...stat("max", extreme((values) => Math.max(...values), valuesOf(pointsOf(rows, "temperature_max_c")), temperatures)),
        ...stat("min", extreme((values) => Math.min(...values), valuesOf(pointsOf(rows, "temperature_min_c")), temperatures)),
        ...stat("mean", mean(temperatures)),
      ],
    });
  }

  const rain = pointsOf(rows, "precipitation_mm");
  if (valuesOf(rain).length) {
    panels.push({
      key: "precipitation",
      unit: "mm",
      digits: 1,
      series: [{ key: "precipitation", style: "bars", points: rain }],
      stats: stat("total", sum(valuesOf(rain))),
      floor: 0.5,
    });
  }

  const sunshine = pointsOf(rows, "sunshine_minutes");
  if (valuesOf(sunshine).length) {
    panels.push({
      key: "sunshine",
      unit: "min",
      digits: 0,
      series: [{ key: "sunshine", style: "bars", points: sunshine }],
      // Hours, as sunshine is told; the bars are minutes of each ten.
      stats: stat("total", sum(valuesOf(sunshine)) / 60),
      fixed: { min: 0, max: 10, ticks: [0, 5, 10] },
    });
  }

  const humidity = pointsOf(rows, "humidity_pct");
  const humidities = valuesOf(humidity);
  if (humidities.length) {
    panels.push({
      key: "humidity",
      unit: "%",
      digits: 0,
      series: [{ key: "humidity", style: "main", points: humidity }],
      stats: [...stat("max", Math.max(...humidities)), ...stat("min", Math.min(...humidities))],
      fixed: { min: 0, max: 100, ticks: [0, 50, 100] },
    });
  }

  const pressure = pointsOf(rows, "pressure_msl_hpa");
  const pressures = valuesOf(pressure);
  if (pressures.length) {
    panels.push({
      key: "pressure",
      unit: "hPa",
      digits: 1,
      series: [{ key: "pressure", style: "main", points: pressure }],
      stats: [
        ...stat("max", Math.max(...pressures)),
        ...stat("min", Math.min(...pressures)),
        // Rising or falling over the window, the tendency a barometer is read for.
        ...stat("change", pressures.length > 1 ? pressures[pressures.length - 1] - pressures[0] : null),
      ],
    });
  }

  const wind = pointsOf(rows, "wind_speed_m_s");
  const gusts = pointsOf(rows, "gust_m_s");
  if (valuesOf(wind).length || valuesOf(gusts).length) {
    panels.push({
      key: "wind",
      unit: "m/s",
      digits: 1,
      series: [
        { key: "gusts", style: "context", points: gusts },
        { key: "wind", style: "main", points: wind },
      ],
      stats: [
        ...stat("gust", extreme((values) => Math.max(...values), valuesOf(gusts))),
        ...stat("mean", valuesOf(wind).length ? mean(valuesOf(wind)) : null),
      ],
      floor: 2,
    });
  }

  const direction = pointsOf(rows, "wind_direction_deg");
  if (valuesOf(direction).length) {
    panels.push({
      key: "direction",
      unit: "°",
      digits: 0,
      series: [{ key: "direction", style: "dots", points: direction }],
      stats: [],
      fixed: { min: 0, max: 360, ticks: [0, 90, 180, 270, 360] },
    });
  }

  return panels;
}

/** The compass point a direction tick is written as. */
export const DIRECTION_TICKS: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W", 360: "N" };

/**
 * The time axis under the panels, in the reader's own time.
 *
 * Over more than two days, the midnights, written as the weekday; over a
 * day, every six hours on the clock, as the model comparison's chart does.
 * On the local clock rather than UTC's, so a tick is on 06:00 where the
 * reader is and not on 07:00 of a winter's day in Germany.
 */
export function historyTicks(from: number, to: number, lang: string): { t: number; label: string }[] {
  const everyDay = to - from > 48 * HOUR;
  const ticks: { t: number; label: string }[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  if (everyDay) cursor.setHours(0);
  else cursor.setHours(Math.floor(cursor.getHours() / 6) * 6);
  for (; cursor.getTime() <= to; everyDay ? cursor.setDate(cursor.getDate() + 1) : cursor.setHours(cursor.getHours() + 6)) {
    const t = cursor.getTime();
    if (t < from) continue;
    ticks.push({
      t,
      label: everyDay
        ? cursor.toLocaleDateString(lang, { weekday: "short" })
        : cursor.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: false }),
    });
  }
  return ticks;
}
