/**
 * The arithmetic behind the model spread: the envelope across models at each
 * step, where "now" is in an hourly series, and whether the models see rain
 * coming soon enough to be worth the short view.
 *
 * Pure, so the strip on the map and the full comparison read the same numbers
 * and the tests can hold them to it.
 */
import type { HourlySeries } from "./openMeteo";

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

export interface Envelope {
  min: Array<number | null>;
  max: Array<number | null>;
  mid: Array<number | null>;
  count: number[];
}

/** min / median / max across whatever models answered, per step, from `from`. */
export function envelope(series: HourlySeries, from: number, steps: number): Envelope {
  const ids = Object.keys(series.series);
  const env: Envelope = { min: [], max: [], mid: [], count: [] };
  for (let i = from; i < from + steps; i += 1) {
    const values = ids
      .map((id) => series.series[id][i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    env.count.push(values.length);
    if (!values.length) {
      env.min.push(null); env.max.push(null); env.mid.push(null);
      continue;
    }
    env.min.push(values[0]);
    env.max.push(values[values.length - 1]);
    env.mid.push(quantile(values, 0.5));
  }
  return env;
}

/**
 * The step holding the present: the hour now falls in.
 *
 * open-meteo's hourly series start at local midnight of the first day, so a
 * plot that starts at index 0 spends its first hours on the past. Where every
 * step is behind now, the last one; where the series is empty, 0.
 */
export function stepAt(times: number[], now: number): number {
  let at = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] > now) break;
    at = i;
  }
  return at;
}

/**
 * Median rain chance at or above this, at any hour of the window, is "rain
 * coming". The median rather than the wettest model: one outlier calling for
 * a shower is exactly the disagreement the plot exists to show, not a verdict.
 */
export const RAIN_LIKELY_PCT = 30;

/** Whether the models' median rain chance reaches RAIN_LIKELY_PCT within `hours` of `from`. */
export function rainWithin(series: HourlySeries, from: number, hours: number): boolean {
  const steps = Math.max(0, Math.min(hours, series.times.length - from));
  return envelope(series, from, steps).mid.some((v) => v !== null && v >= RAIN_LIKELY_PCT);
}
