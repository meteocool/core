import type { CellTrackProperties } from "../api";

/**
 * A storm's numbers, banded so they can be read without knowing radar.
 *
 * "34 kg/m2" and "61 dBZ" are precise and, to almost everyone, meaningless --
 * there is no way to tell from the figures alone whether that is an ordinary
 * shower or the worst cell of the afternoon. Every reading here therefore
 * carries the band it falls in as well as the number, and the popup draws the
 * band as a colour and as a filled meter: colour for the glance, length for
 * anyone who cannot use the colour, and the figure itself for anyone who can
 * read it directly.
 *
 * The bands are the DWD severity classes the rest of the app already speaks --
 * the word in the popup header, the colour of the marker on the map, the ring
 * around a footprint. One scale, four steps, the same meaning everywhere.
 *
 * Cut points are the operational ones rather than anything derived: 55 dBZ is
 * where large hail becomes likely, 12 km puts an echo top through the
 * tropopause over central Europe, 25 kg/m2 of VIL is the usual hail threshold,
 * and so on. They are judgement calls, and they are all in this one table so
 * they can be argued with in one place.
 */

export type Band = 0 | 1 | 2 | 3;

export const BAND_NAMES = ["weak", "moderate", "strong", "extreme"] as const;

interface Metric {
  key: string;
  label: string;
  /** The three cut points between the four bands. */
  cuts: [number, number, number];
  /** What the meter's track spans, [empty, full]. */
  domain: [number, number];
  unit: string;
  digits: number;
}

const METRICS: Record<string, Metric> = {
  peak: {
    key: "peak", label: "peak", cuts: [45, 55, 60], domain: [20, 68], unit: "dBZ", digits: 1,
  },
  echoTop: {
    key: "echoTop", label: "echo top", cuts: [7, 10, 12.5], domain: [2, 15], unit: "km", digits: 1,
  },
  vil: {
    key: "vil", label: "VIL", cuts: [10, 25, 40], domain: [0, 55], unit: "kg/m²", digits: 1,
  },
  speed: {
    key: "speed", label: "motion", cuts: [30, 55, 75], domain: [0, 95], unit: "km/h", digits: 0,
  },
  gust: {
    key: "gust", label: "gusts", cuts: [50, 75, 100], domain: [0, 125], unit: "km/h", digits: 0,
  },
  lightning: {
    key: "lightning", label: "lightning", cuts: [5, 25, 60], domain: [0, 80], unit: "/5 min", digits: 0,
  },
};

export interface Reading {
  key: string;
  label: string;
  /** The number and its unit, ready to print. */
  text: string;
  /** Which of the four classes it falls in, or null when nothing was reported. */
  band: Band | null;
  /** What that class is called, for anyone the colour does not reach. */
  bandName: string | null;
  /** How far along its track the meter fills, 0 to 1. */
  fill: number;
}

const band = (metric: Metric, value: number): Band => (
  metric.cuts.filter((cut) => value >= cut).length as Band
);

const fillOf = (metric: Metric, value: number): number => {
  const [low, high] = metric.domain;
  return Math.min(Math.max((value - low) / (high - low), 0), 1);
};

/** One reading, or a blank one when the feed did not report the value. */
export function reading(
  key: keyof typeof METRICS,
  value: number | null | undefined,
  suffix = "",
): Reading {
  const metric = METRICS[key];
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return {
      key, label: metric.label, text: "–", band: null, bandName: null, fill: 0,
    };
  }
  const index = band(metric, value);
  // "31 /5 min" reads as a typo; a unit that is already a solidus joins on.
  const gap = metric.unit.startsWith("/") ? "" : " ";
  return {
    key,
    label: metric.label,
    text: `${value.toFixed(metric.digits)}${gap}${metric.unit}${suffix}`,
    band: index,
    bandName: BAND_NAMES[index],
    fill: fillOf(metric, value),
  };
}

/** Everything worth a meter, in the order it is read. */
export function cellReadings(
  track: CellTrackProperties,
  compass: (deg: number | null | undefined) => string,
): Reading[] {
  const series = track.series ?? [];
  const latest = series[series.length - 1];
  const out = [
    reading("peak", track.max_dbz),
    reading("echoTop", track.echo_top_max_m == null ? null : track.echo_top_max_m / 1000),
    reading("vil", track.vil_max),
  ];
  if (latest) {
    out.push(reading("speed", latest.speed_kmh, ` ${compass(latest.heading_deg)}`));
    // Only when there is something to say: a blank meter for every storm that
    // never gusted is six rows of nothing on a panel this size.
    if (latest.gust_kmh) out.push(reading("gust", latest.gust_kmh));
    if (latest.lightning_rate) out.push(reading("lightning", latest.lightning_rate));
  }
  return out;
}
