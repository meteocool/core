<script lang="ts">
/**
 * What the weather models say, in the strip the rain chart takes when there
 * is rain -- for the reader's own position, on a day the radar has nothing
 * for it.
 *
 * On a dry day the radar map is an empty map and the rain chart has nothing to
 * plot, so the slot above the tray would be empty exactly when the reader's
 * question has moved on from "is it raining" to "and later?". The model
 * comparison answers that, so a small copy of its spread goes here: every
 * model's hourly rainfall as one thicket, the range as a band, the median on top.
 *
 * Over the week, unless the models see rain inside a day, when the week would
 * squash it into a sliver at the left edge and the next 24 hours are the
 * answer instead. See lib/compare/outlook.ts for where that line is.
 *
 * The title says how far off that rain is -- "Rain likely in 5 hours", "in
 * 3 days" -- and "No rain in sight" only over a week the models agree is dry.
 * It used to say "Dry for now" over the day the models had just agreed it
 * would rain in, which is true of the radar and the opposite of the chart.
 *
 * Tapping it, or its "All models" chip, opens the whole comparison in the
 * drawer (see App.svelte), on the range the strip was showing.
 *
 * The strip is the same one the rain chart and the lightning histogram use,
 * swipe-to-clear included; the caller owns whether it is up. A first fetch
 * that fails says "unavailable" and the caller takes it down -- this is a
 * hint, and an error in its place is noise.
 */
import { createEventDispatcher, onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import type { Chart } from "chart.js";
import { faChartLine } from "@fortawesome/free-solid-svg-icons/faChartLine";
import DismissableStrip from "./DismissableStrip.svelte";
import { fetchHourlySeries, type HourlySeries } from "../lib/compare/openMeteo";
import { drawSpread, RAINFALL } from "../lib/compare/spreadChart";
import { rainIn, stepAt } from "../lib/compare/outlook";
import { openModelCompare } from "../lib/modelCompare";
import { onWake } from "../lib/wakeup";

export let lat: number;
export let lon: number;
/** Whether the tray below is the short bar or the full player. */
export let collapsed = true;

const dispatch = createEventDispatcher<{ dismiss: void; unavailable: void }>();

const WEEK = 168;
const DAY = 24;

let data: HourlySeries | null = null;
let canvas: HTMLCanvasElement | null = null;
let chart: Chart | null = null;
/** The present the plot starts from and the title counts from; moved on by a wake. */
let now = Date.now();

$: from = data ? stepAt(data.times, now) : 0;
/** Hours until the models agree on rain, within the week; null for a dry week. */
$: wetIn = data ? rainIn(data, from, WEEK) : null;
$: soon = wetIn !== null && wetIn < DAY;
$: hours = soon ? DAY : WEEK;
// Neutral until the models answer: "No rain in sight" before they have is a
// claim nobody made, and it flashed before every "Rain likely in …".
$: title = !data
  ? $_("dry_outlook_label")
  : wetIn === null
  ? $_("dry_outlook_title_week")
  : soon
    ? $_("dry_outlook_title_hours", { values: { hours: wetIn } })
    : $_("dry_outlook_title_days", { values: { days: Math.max(1, Math.round(wetIn / DAY)) } });

async function load() {
  try {
    data = await fetchHourlySeries({ lat, lon, forecastDays: 7, variable: "precipitation" });
  } catch {
    // Up with an answer already, a refresh that fails keeps it: the models'
    // hours are still the best guess at them, and a strip that went down for
    // the session over one bad minute of network would be the worse hint.
    if (!data) dispatch("unavailable");
  }
  now = Date.now();
}

onMount(load);

/*
 * Brought up to date on a wake. The strip stays up for as long as the dry
 * spell does, and it counted "Rain likely in 5 hours" from when it was put
 * up: a phone back from an afternoon in a pocket was told the same five
 * hours. Asked again -- from the cache while that answer is under ten
 * minutes old, see fetchHourlySeries -- and counted from now either way.
 */
const unsubscribeWake = onWake(() => { void load(); });

function draw(start: number, steps: number) {
  if (!canvas || !data) return;
  chart?.destroy();
  chart = drawSpread(canvas, data, { from: start, steps, spec: RAINFALL, compact: true });
}
// Both as arguments, so a wake that moves `from` redraws as well as retitles.
$: if (canvas && data) draw(from, hours);
onDestroy(() => {
  unsubscribeWake();
  chart?.destroy();
});

const openFull = () => openModelCompare(lat, lon, hours);
</script>

<DismissableStrip
  {title}
  linkLabel={$_("dry_outlook_link")}
  linkIcon={faChartLine}
  {collapsed}
  tappable
  on:dismiss
  on:tap={openFull}
  on:link={openFull}>
  <div class="plot">
    {#if data}
      <canvas bind:this={canvas} aria-label={$_("dry_outlook_label")}></canvas>
    {:else}
      <p class="loading">{$_("dry_outlook_loading")}</p>
    {/if}
  </div>
</DismissableStrip>

<style>
  /* The rain chart's insets, so the two strips hold their plots in the same
     place and switching between them does not shift anything. */
  .plot {
    position: relative;
    height: 100%;
    margin: 2px var(--mc-tray-pad) 0 calc(var(--mc-tray-pad) + 2px);
  }
  canvas {
    display: block;
  }
  .loading {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    color: var(--mc-text-2);
    font: 400 12px/1.35 var(--mc-font);
    letter-spacing: -0.005em;
  }
</style>
