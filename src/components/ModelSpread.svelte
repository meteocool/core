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
import { _, locale } from "svelte-i18n";
import type { Chart } from "chart.js";
import { fetchHourlySeries, type HourlySeries } from "../lib/compare/openMeteo";
import { drawSpread } from "../lib/compare/spreadChart";
import { stepAt } from "../lib/compare/outlook";
import { onWake } from "../lib/wakeup";
import Segmented from "./Segmented.svelte";

export let lat: number;
export let lon: number;
/** Which range to open on: 24 (the default) or 168. */
export let initialHours = 24;

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

/* Each one's label is `compare.variable.<id>`. */
const VARIABLES: Array<{ id: Variable; unit: string; max?: number }> = [
  { id: "precipitation_probability", unit: "%", max: 100 },
  { id: "temperature_2m", unit: "°" },
];

/* A day is what the next decision is made on; the week is for planning. The
   long view is a toggle rather than the default because seven days of hourly
   lines compresses each day into ~90px, where the daily cycle is a blur. */
const RANGES: Array<{ hours: number; key: string }> = [
  { hours: 24, key: "compare.range.day" },
  { hours: 168, key: "compare.range.week" },
];

let variable: Variable = "precipitation_probability";
let hours = initialHours;

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

function build(node: HTMLCanvasElement) {
  canvas = node;
  if (data) draw();
  return { destroy() { chart?.destroy(); chart = null; canvas = null; } };
}

function draw() {
  if (!canvas || !data) return;
  chart?.destroy();
  // The window, not the whole download: the range toggle slices what is here.
  // From the present hour, not from index 0: open-meteo's series start at
  // local midnight, so "24 h" used to spend the morning's first hours on the
  // past and stop short of this time tomorrow.
  chart = drawSpread(canvas, data, { from: stepAt(data.times, Date.now()), steps: hours, spec });
}

async function load(which: Variable) {
  const cached = fetched[which];
  if (cached) {
    data = cached;
    // The other variable's failure is not this one's.
    error = null;
    loading = false;
    draw();
    return;
  }
  loading = true;
  // Back to the dimmed plot while it asks, on a retry as on a switch.
  error = null;
  try {
    // Always the full week, whatever the range toggle says: the long view is
    // then free, and one variable is one request for the session. No signal:
    // one would opt it out of the cache the map's dry-day strip shares with
    // this (see fetchHourlySeries), and an answer that lands after the panel
    // has closed is the next one's.
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
    // Nor may its failure: the error used to replace a plot that had loaded.
    if (which === variable) error = e instanceof Error ? e.message : String(e);
  } finally {
    if (which === variable) loading = false;
    draw();
  }
}

$: load(variable);

/* Failed, it used to stay failed until the panel was closed; a wake asks again. */
const unsubscribeWake = onWake(() => { if (error) load(variable); });

/* Redrawing on a range change is a slice, not a fetch. Named so the reactive
   block has something to depend on without re-running for anything else --
   the language included, since the axis labels are baked in at draw time. */
$: if (data && hours && $locale) draw();

onDestroy(() => {
  unsubscribeWake();
  chart?.destroy();
});

$: modelCount = data ? Object.keys(data.series).length : 0;
</script>

<style>
  /* The heading is the drawer's own section heading (StormPanel's .section);
     this only sets what sits under it. */
  .wrap {
    margin: 0 0 8px;
  }

  .sub {
    margin: -4px 0 12px;
    font: 400 13px/1.4 var(--mc-font);
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

  /* Beside the error line it retries. */
  .mc-retry {
    margin-inline-start: 6px;
  }
</style>

<div class="wrap">
  <h3 class="section">{$_("compare.spread.heading", { values: { variable: $_(`compare.variable.${spec.id}`) } })}</h3>
  <p class="sub">{$_("compare.spread.sub")}</p>

  <div class="controls">
    <Segmented
      bind:value={variable}
      label={$_("compare.spread.variable_group")}
      options={VARIABLES.map((option) => ({ value: option.id, label: $_(`compare.variable.${option.id}`) }))} />
    <Segmented
      bind:value={hours}
      label={$_("compare.spread.range_group")}
      options={RANGES.map((option) => ({ value: option.hours, label: $_(option.key) }))} />
  </div>

  {#if error}
    <p class="error">
      {$_("compare.spread.error")} {error}
      <button type="button" class="mc-retry small" on:click={() => load(variable)}>{$_("retry")}</button>
    </p>
  {:else}
    <div class="plot" class:loading>
      <canvas use:build></canvas>
    </div>
    <div class="legend">
      <span><i class="key"></i>{$_("compare.spread.median")}</span>
      <span><i class="key band"></i>{$_("compare.spread.range")}</span>
      <span><i class="key thin"></i>{$_("compare.models", { values: { count: modelCount || 21 } })}</span>
    </div>
  {/if}
</div>
