/**
 * The model spread as a chart: every model as one recessive thicket, their
 * min-max range as a band behind it, the median on top in the accent.
 *
 * Shared by the full comparison (ModelSpread) and the dry-weather strip on the
 * map, which draws the same plot small. See ModelSpread for why it is not
 * twenty-one coloured lines.
 */
import {
  CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip,
} from "chart.js";
import { currentLocale, t } from "../../locale/t";
import { modelById } from "./models";
import { envelope } from "./outlook";
import type { HourlySeries } from "./openMeteo";

Chart.register(LineController, LineElement, PointElement, Filler, Tooltip, CategoryScale, LinearScale);

export interface SpreadSpec {
  unit: string;
  /** A fixed ceiling, for a probability. */
  max?: number;
  /** A ceiling the axis starts at and grows past, for an amount. */
  suggestedMax?: number;
}

/**
 * Hourly rainfall, mm in the hour before each step. Always 0-6 mm unless a
 * model forecasts more, so a few drops and a downpour read apart at a glance:
 * auto-scaled, a tenth of a millimetre of drizzle fills the plot like a
 * cloudburst would.
 */
export const RAINFALL: SpreadSpec = { unit: " mm", suggestedMax: 6 };

export interface SpreadOptions {
  /** First step plotted. */
  from: number;
  /** How many hourly steps. */
  steps: number;
  spec: SpreadSpec;
  /** The strip's size: smaller type, fewer value ticks, no padding. */
  compact?: boolean;
}

/** Read once per build: the tokens flip with the theme, the chart does not. */
const token = (element: Element, name: string, fallback: string) => (
  getComputedStyle(element).getPropertyValue(name).trim() || fallback
);

/**
 * Which x positions are worth a label, at this range.
 *
 * Over a week that is the midnights, one per day. Over a day the midnights are
 * one tick, so the axis marks every six hours instead; the same rule at both
 * ranges would leave a 24h chart with a single label on it.
 */
function labels(times: number[], span: number): string[] {
  const everyDay = span > 48;
  const lang = currentLocale();
  return times.map((t) => {
    const d = new Date(t);
    if (everyDay) {
      return d.getHours() === 0
        ? d.toLocaleDateString(lang, { weekday: "short" })
        : "";
    }
    return d.getHours() % 6 === 0
      // 24-hour throughout the app: these are meteorological times, read
      // against model runs and radar timestamps that are all written that way.
      ? d.toLocaleTimeString(lang, { hour: "numeric", hour12: false })
      : "";
  });
}

/**
 * Null when the canvas has no 2D context to give: iOS stops handing them out
 * once the page's canvases have used up its canvas memory, and Chart.js then
 * reported "can't acquire context" as an error and built a chart that could
 * not draw.
 */
export function drawSpread(canvas: HTMLCanvasElement, data: HourlySeries, options: SpreadOptions): Chart | null {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { spec, compact = false } = options;
  const from = Math.max(0, Math.min(options.from, data.times.length));
  const steps = Math.max(0, Math.min(options.steps, data.times.length - from));

  // Off the canvas, not the root: the strip sits on glass whose ink follows
  // the basemap, and the full panel on a sheet that follows the OS.
  const ink = token(canvas, "--mc-text-2", "#666");
  const faint = token(canvas, "--mc-hairline", "rgba(0,0,0,0.1)");
  const accent = token(canvas, "--mc-accent", "#007aff");
  const band = token(canvas, "--mc-accent-tint", "rgba(0,122,255,0.14)");
  const thicket = token(canvas, "--mc-plot-thicket", "rgba(60,60,67,0.16)");

  const times = data.times.slice(from, from + steps);
  const env = envelope(data, from, steps);
  const ticks = compact ? 3 : 5;
  // Inside a soft ceiling, steps that land on it: left to Chart.js, the
  // strip's three ticks round 0-6 mm up to 0-10.
  const top = Math.max(0, ...env.max.filter((v): v is number => v !== null));
  const stepSize = spec.suggestedMax && top <= spec.suggestedMax
    ? spec.suggestedMax / (compact ? 2 : 3)
    : undefined;
  const ids = Object.keys(data.series);
  const labelAt = labels(times, steps);
  const tickFont = compact ? { size: 10 } : undefined;

  const modelLines = ids.map((id) => ({
    label: modelById(id)?.label ?? id,
    data: data.series[id].slice(from, from + steps),
    borderColor: thicket,
    borderWidth: compact ? 1 : 1.25,
    pointRadius: 0,
    // The hit area is generous even though the line is hairline: picking one
    // model out of twenty-one is the whole interaction.
    pointHitRadius: 8,
    hoverBorderWidth: 2.5,
    hoverBorderColor: accent,
    tension: 0.25,
    fill: false,
    order: 3,
  }));

  return new Chart(context, {
    type: "line",
    data: {
      labels: labelAt,
      datasets: [
        {
          label: "warmest",
          data: env.max,
          borderColor: "transparent",
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
          order: 5,
        },
        {
          label: "range",
          data: env.min,
          borderColor: "transparent",
          backgroundColor: band,
          pointRadius: 0,
          pointHitRadius: 0,
          // Fills up to the dataset before it: the models' full spread.
          fill: "-1",
          order: 5,
        },
        ...modelLines,
        {
          // Shown: the median's own line can be the nearest one to a hover.
          label: t("compare.spread.median"),
          data: env.mid,
          borderColor: accent,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.25,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false, axis: "xy" },
      layout: { padding: compact ? { top: 2, right: 0, bottom: 0, left: 0 } : { top: 4, right: 2, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          /* The band is drawn with two invisible datasets; when a model's line
             runs along the edge of the range, "nearest" picks both and the
             tooltip says the same thing twice under a meaningless name. */
          filter: (item) => item.dataset.label !== "range"
            && item.dataset.label !== "warmest",
          // Every model is a dataset; listing all of them would be a wall.
          // The nearest line is the one being asked about.
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex ?? 0;
              return new Date(times[index]).toLocaleString(currentLocale(), {
                weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
              });
            },
            label: (item) => {
              const index = item.dataIndex;
              const lo = env.min[index];
              const hi = env.max[index];
              const digits = spec.max ? 0 : 1;
              const spread = lo != null && hi != null ? (hi - lo).toFixed(digits) : "–";
              return [
                `${item.dataset.label}: ${Number(item.parsed.y).toFixed(spec.max ? 0 : 1)}${spec.unit}`,
                t("compare.spread.tooltip", { values: {
                  median: env.mid[index]?.toFixed(digits) ?? "–", spread, count: env.count[index],
                } }),
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: true,
            drawTicks: false,
            /* A rule per day, not per hour: 168 verticals is a hatch, and the
               only x position worth marking is where one day becomes the next. */
            color: (ctx) => (labelAt[ctx.index] ? faint : "transparent"),
          },
          border: { display: false },
          ticks: {
            color: ink,
            font: tickFont,
            autoSkip: false,
            maxRotation: 0,
            padding: compact ? 2 : 3,
            callback: (_value, index) => labelAt[index] ?? "",
          },
        },
        y: {
          grid: { color: faint, drawTicks: false },
          border: { display: false },
          // A probability has a fixed ceiling, so the axis keeps it: a chart
          // auto-scaled to 0-40% makes a quiet day look like a wet one. An
          // amount has a floor to its ceiling, for the same reason.
          min: spec.max || spec.suggestedMax ? 0 : undefined,
          max: spec.max,
          suggestedMax: spec.suggestedMax,
          ticks: {
            color: ink,
            font: tickFont,
            maxTicksLimit: ticks,
            stepSize,
            padding: compact ? 4 : 3,
            callback: (v) => `${v}${spec.unit}`,
          },
        },
      },
    },
  });
}
