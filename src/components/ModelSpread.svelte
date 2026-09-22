<script lang="ts">
/**
 * Every model's hourly temperature in one plot, which is the comparison
 * meteocompare is for: not what any single model says, but how far apart they
 * are and when they start to disagree.
 *
 * Deliberately NOT twenty-one coloured lines. A categorical palette runs out at
 * about eight hues before adjacent pairs stop being separable -- at twenty-one
 * the colours would be decoration that actively lies about which line is which.
 * So the models are drawn as one recessive thicket, their min-max range as a
 * band behind it, and the median on top in the accent. You read the spread,
 * which is the question; a specific model you read from the table below, or by
 * hovering its line.
 *
 * Hover gives back what colour would have: the nearest line lifts out of the
 * thicket and the tooltip names it.
 */
import { onDestroy } from "svelte";
import {
  Chart, Filler, LineController, LineElement, PointElement, Tooltip,
} from "chart.js";
import { fetchHourlySeries, type HourlySeries } from "../lib/compare/openMeteo";
import { modelById } from "../lib/compare/models";

export let lat: number;
export let lon: number;

Chart.register(LineController, LineElement, PointElement, Filler, Tooltip);

/**
 * Rain chance leads, temperature is a tap away.
 *
 * "Will it rain" is the question people open a weather app with, and it is also
 * the one the models disagree about most -- a spread of 40 points on a
 * probability is a real disagreement, where two degrees of temperature is
 * noise. Temperature is the calmer, prettier curve, which is exactly why it
 * should not be the one on screen by default.
 */
type Variable = "precipitation_probability" | "temperature_2m";

const VARIABLES: Array<{ id: Variable; label: string; unit: string; max?: number }> = [
  { id: "precipitation_probability", label: "Rain Chance", unit: "%", max: 100 },
  { id: "temperature_2m", label: "Temperature", unit: "°" },
];

/* A day is what the next decision is made on; the week is for planning. The
   long view is a toggle rather than the default because seven days of hourly
   lines compresses each day into ~90px, where the daily cycle is a blur. */
const RANGES: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 Days" },
];

let variable: Variable = "precipitation_probability";
let hours = 24;

/* One fetch per variable, kept: the range toggle is a slice of what is already
   here, and switching back and forth should not re-ask open-meteo.

   A plain record, not a Map: nothing renders from it, it is read inside an
   async load and never iterated reactively. */
const fetched: Partial<Record<Variable, HourlySeries>> = {};

let data: HourlySeries | null = null;
let error: string | null = null;
let loading = true;
let chart: Chart | null = null;
let canvas: HTMLCanvasElement | null = null;

$: spec = VARIABLES.find((v) => v.id === variable)!;

/** Read once per build: the tokens flip with the theme, the chart does not. */
const token = (name: string, fallback: string) => (
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/** min / median / max across whatever models answered, per step. */
function envelope(series: HourlySeries, steps: number) {
  const ids = Object.keys(series.series);
  const min: Array<number | null> = [];
  const max: Array<number | null> = [];
  const mid: Array<number | null> = [];
  const count: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const values = ids
      .map((id) => series.series[id][i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    count.push(values.length);
    if (!values.length) {
      min.push(null); max.push(null); mid.push(null);
      continue;
    }
    min.push(values[0]);
    max.push(values[values.length - 1]);
    mid.push(quantile(values, 0.5));
  }
  return { min, max, mid, count };
}

/**
 * Which x positions are worth a label, at this range.
 *
 * Over a week that is the midnights, one per day. Over a day the midnights are
 * one tick, so the axis marks every six hours instead -- the same rule at both
 * ranges would leave a 24h chart with a single label on it.
 */
function labels(times: number[], span: number): string[] {
  const everyDay = span > 48;
  return times.map((t) => {
    const d = new Date(t);
    if (everyDay) {
      return d.getHours() === 0
        ? d.toLocaleDateString(undefined, { weekday: "short" })
        : "";
    }
    return d.getHours() % 6 === 0
      // 24-hour throughout the app: these are meteorological times, read
      // against model runs and radar timestamps that are all written that way.
      ? d.toLocaleTimeString(undefined, { hour: "numeric", hour12: false })
      : "";
  });
}

function build(node: HTMLCanvasElement) {
  canvas = node;
  if (data) draw();
  return { destroy() { chart?.destroy(); chart = null; canvas = null; } };
}

function draw() {
  if (!canvas || !data) return;
  chart?.destroy();

  const ink = token("--mc-text-2", "#666");
  const faint = token("--mc-hairline", "rgba(0,0,0,0.1)");
  const accent = token("--mc-accent", "#007aff");
  const band = token("--mc-accent-tint", "rgba(0,122,255,0.14)");
  const thicket = token("--mc-plot-thicket", "rgba(60,60,67,0.16)");

  // The window, not the whole download: the range toggle slices what is here.
  const steps = Math.min(hours, data.times.length);
  const times = data.times.slice(0, steps);
  const env = envelope(data, steps);
  const ids = Object.keys(data.series);
  const labelAt = labels(times, steps);

  const modelLines = ids.map((id) => ({
    label: modelById(id)?.label ?? id,
    data: data!.series[id].slice(0, steps),
    borderColor: thicket,
    borderWidth: 1.25,
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

  chart = new Chart(canvas.getContext("2d")!, {
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
          label: "median",
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
      layout: { padding: { top: 4, right: 2, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        /* The datalabels plugin is registered app-wide for the radar chart, so
           without this it writes a number onto all 2500 points here. */
        datalabels: { display: false },
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
              return new Date(times[index]).toLocaleString(undefined, {
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
                `median ${env.mid[index]?.toFixed(digits) ?? "–"} · spread ${spread} · ${env.count[index]} models`,
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
            autoSkip: false,
            maxRotation: 0,
            callback: (_value, index) => labelAt[index] ?? "",
          },
        },
        y: {
          grid: { color: faint, drawTicks: false },
          border: { display: false },
          // A probability has a fixed ceiling, so the axis keeps it: a chart
          // auto-scaled to 0-40% makes a quiet day look like a wet one.
          min: spec.max ? 0 : undefined,
          max: spec.max,
          ticks: { color: ink, maxTicksLimit: 5, callback: (v) => `${v}${spec.unit}` },
        },
      },
    },
  });
}

async function load(which: Variable) {
  const cached = fetched[which];
  if (cached) {
    data = cached;
    loading = false;
    draw();
    return;
  }
  loading = true;
  try {
    // Always the full week, whatever the range toggle says: the long view is
    // then free, and one variable is one request for the session.
    const series = await fetchHourlySeries({
      lat, lon, forecastDays: 7, variable: which,
    });
    fetched[which] = series;
    // A slow fetch for a variable the reader has since switched away from must
    // not paint over the one they are looking at.
    if (which !== variable) return;
    data = series;
    error = null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (which === variable) loading = false;
    draw();
  }
}

$: load(variable);
/* Redrawing on a range change is a slice, not a fetch. Named so the reactive
   block has something to depend on without re-running for anything else. */
$: if (data && hours) draw();

onDestroy(() => chart?.destroy());

$: modelCount = data ? Object.keys(data.series).length : 0;
</script>

<style>
  .wrap {
    margin: 0 16px 8px;
  }

  h2 {
    margin: 0 0 1px;
    font: 700 15px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
  }

  .sub {
    margin: 0 0 8px;
    font: 400 12px/1.35 var(--mc-font);
    color: var(--mc-text-2);
  }

  /* Two segmented controls on one line: what is plotted, and over how long.
     Both are small closed sets, which is what a segmented control is for --
     the options stay visible, so the alternative is readable without opening
     anything. */
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .segmented {
    display: inline-flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--mc-tint);
  }

  .segmented button {
    padding: 4px 11px;
    border: 0;
    border-radius: 7px;
    background: none;
    color: var(--mc-text-2);
    font: 600 12px/1.2 var(--mc-font);
    letter-spacing: -0.01em;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--mc-motion-fast) var(--mc-ease),
                color var(--mc-motion-fast) var(--mc-ease);
  }
  .segmented button.on {
    background: var(--mc-sheet);
    color: var(--mc-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .plot {
    position: relative;
    height: 200px;
    transition: opacity var(--mc-motion) var(--mc-ease);
  }
  /* Dimmed rather than emptied while the other variable arrives: the axis and
     the shape stay put, so the toggle does not make the page jump. */
  .plot.loading {
    opacity: 0.45;
  }

  /* Three entries, not twenty-one: the thicket is one thing, and naming each
     strand would be the legend the colours could not carry either. */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 6px;
    font: 500 11px/1.4 var(--mc-font);
    color: var(--mc-text-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .key {
    width: 14px;
    height: 0;
    border-top: 2px solid var(--mc-accent);
  }
  .key.thin {
    border-top: 1px solid var(--mc-text-3);
  }
  .key.band {
    height: 9px;
    border: 0;
    border-radius: 2px;
    background: var(--mc-accent-tint);
  }

  .error {
    margin: 0;
    font: 400 12px/1.4 var(--mc-font);
    color: var(--mc-text-2);
  }
</style>

<div class="wrap">
  <h2>{spec.label}, all models</h2>
  <p class="sub">
    Where they agree the band is narrow. Where it widens, the forecast is a
    guess. Hover a line to see which model it is.
  </p>

  <div class="controls">
    <div class="segmented" role="group" aria-label="Variable">
      {#each VARIABLES as option (option.id)}
        <button
          type="button"
          class:on={variable === option.id}
          aria-pressed={variable === option.id}
          on:click={() => { variable = option.id; }}>{option.label}</button>
      {/each}
    </div>
    <div class="segmented" role="group" aria-label="Range">
      {#each RANGES as option (option.hours)}
        <button
          type="button"
          class:on={hours === option.hours}
          aria-pressed={hours === option.hours}
          on:click={() => { hours = option.hours; }}>{option.label}</button>
      {/each}
    </div>
  </div>

  {#if error}
    <p class="error">Could not load the model spread. {error}</p>
  {:else}
    <div class="plot" class:loading>
      <canvas use:build></canvas>
    </div>
    <div class="legend">
      <span><i class="key"></i>Median</span>
      <span><i class="key band"></i>Range Across Models</span>
      <span><i class="key thin"></i>{modelCount || 21} models</span>
    </div>
  {/if}
</div>
