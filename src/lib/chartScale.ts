/**
 * The value scale and traces of the panels' hand-drawn history charts: a
 * storm's (StormDetails) and a weather station's (StationHistory). Small
 * multiples over one clock, each panel with a scale of its own.
 *
 * A bare sparkline with no scale can say "went up a bit" and nothing more: a
 * rise from 48 to 52 dBZ and one from 30 to 62 draw the identical line,
 * because both are normalised to the box. So every panel gets ticks at round
 * values, and its box is padded out to them.
 */

/** Tick values at 1, 2, 2.5 or 5 times a power of ten, whichever fits. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const span = max - min || 1;
  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)
    ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1000; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
  at: (value: number) => number;
}

/** A vertical scale over `values`, padded out to whole ticks. */
export function verticalScale(values: number[], y0: number, y1: number, target = 4): Scale | null {
  const real = values.filter((v) => Number.isFinite(v));
  if (real.length < 2) return null;
  const low = Math.min(...real);
  const high = Math.max(...real);
  // A flat series still needs a box to sit in, or every point lands on one row.
  const pad = (high - low || Math.max(Math.abs(high) * 0.1, 1)) * 0.15;
  const ticks = niceTicks(low - pad, high + pad, target);
  const min = Math.min(low - pad, ticks[0]);
  const max = Math.max(high + pad, ticks[ticks.length - 1]);
  return {
    min,
    max,
    ticks,
    at: (value: number) => y0 + ((value - min) / (max - min)) * (y1 - y0),
  };
}

/**
 * A scale over a range fixed beforehand rather than read off the values:
 * humidity's 0 to 100 %, a direction's 0 to 360°, the minutes of sunshine
 * ten minutes can hold. `ticks` are given, for the same reason.
 */
export function fixedScale(min: number, max: number, ticks: number[], y0: number, y1: number): Scale {
  return { min, max, ticks, at: (value: number) => y0 + ((value - min) / (max - min)) * (y1 - y0) };
}

/**
 * Points along a series, skipping steps where that series is missing.
 *
 * With `maxGap`, also lifting the pen where two readings are further apart
 * than that: a station that went quiet for an hour has no line across it,
 * which would draw values nobody measured.
 */
export function path(
  steps: Array<{ t: number; v: number | null | undefined }>,
  atX: (t: number) => number,
  scale: Scale | null,
  maxGap = Infinity,
): string {
  if (!scale) return "";
  let open = false;
  let last = -Infinity;
  return steps
    .map(({ t, v }) => {
      if (v === null || v === undefined || !Number.isFinite(v)) {
        open = false;
        return "";
      }
      const command = open && t - last <= maxGap ? "L" : "M";
      open = true;
      last = t;
      return `${command}${atX(t).toFixed(1)},${scale.at(v).toFixed(1)}`;
    })
    .join("");
}
