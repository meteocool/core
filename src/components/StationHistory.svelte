<script lang="ts">
/**
 * What a weather station measured over the last day, three or seven: its
 * meteogram, a section of the station's sheet (StationDetails).
 *
 * Small multiples over one clock, as a storm's history is drawn
 * (StormDetails), with its ink: a panel per quantity. Laid out as the
 * system's own charts are (Health, Weather): the name, then the figure the
 * panel is read for in large type (the newest value, or the total of an
 * amount) with what sums it up beside it, then a plot that runs the sheet's
 * width with its scale on the trailing edge. Drawn at the width it is given
 * rather than scaled into it, so the type is the same size on every screen
 * and a wider sheet is a longer time axis, not larger letters. What the
 * panels hold, and what each is summed up by, is lib/stationHistory.ts's.
 *
 * Asked for when the sheet opens and again when the period changes, and on
 * a wake: DWD publishes every ten minutes, so a sheet left open goes stale.
 */
import { _, locale } from "svelte-i18n";
import { onDestroy } from "svelte";
import { fetchStationHistory, quietly } from "../api";
import { fixedScale, niceTicks, path, verticalScale, type Scale } from "../lib/chartScale";
import {
  askSince, DIRECTION_TICKS, HISTORY_WINDOWS, historyPanels, historyTicks, MAX_GAP_MS, windowStart,
  type HistoryPanel, type HistoryWindow, type ObservationRow, type Series, type Stat,
} from "../lib/stationHistory";
import { currentLocale } from "../locale/t";
import { formatNumber } from "../lib/stations";
import { onWake } from "../lib/wakeup";
import { decideAxis, type SwipeAxis } from "../lib/swipeAway";
import { haptic } from "../lib/haptics";
import Segmented from "./Segmented.svelte";
import ChartSkeleton from "./ChartSkeleton.svelte";

/** DWD's id of the station. */
export let station: string;

/** The plot's top inset, room for the highest tick's label to be centred on its line. */
const TOP = 7;
const PANEL_H = 96;
/** Room for the time labels, under every panel: a panel read on its own still says when. */
const AXIS_ROOM = 18;
/** The scale's labels, on the trailing edge: their size, and the gap to the plot. */
const TICK_PX = 10;
const TICK_GAP = 6;
/** Until the first layout says otherwise: the desktop drawer's width. */
const FALLBACK_WIDTH = 340;
/** A row is ten minutes; a bar is that wide. */
const ROW_MS = 10 * 60_000;

let period: HistoryWindow = "day";
let rows: ObservationRow[] = [];
let span: { from: number; to: number } | null = null;
let state: "loading" | "ready" | "none" = "loading";

/*
 * The newest request only: a station tapped after another, or a period
 * changed, while the first answer is on its way would otherwise have that
 * answer land on the new one.
 */
let token = 0;
async function load(id: string, chosen: HistoryWindow, quiet = false): Promise<void> {
  const mine = ++token;
  if (!quiet) state = "loading";
  const now = Date.now();
  const from = windowStart(chosen, now);
  try {
    const answer = await fetchStationHistory(id, new Date(askSince(chosen, now)), quiet ? quietly : undefined);
    if (mine !== token) return;
    rows = answer.observations;
    span = { from, to: now };
    at = null;
    state = rows.length ? "ready" : "none";
  } catch {
    // Absent or refused: the request layer has said what it needs to.
    if (mine !== token || (quiet && state === "ready")) return;
    rows = [];
    state = "none";
  }
}
$: load(station, period);
const unsubscribeWake = onWake(() => load(station, period, true));
onDestroy(unsubscribeWake);

/* The reader's language, for the commas and points: named so all is written again when it changes. */
$: lang = $locale ?? currentLocale();
const number = (value: number, digits: number, language: string) => formatNumber(value, digits, language);
/** A value with its unit after it: 13,2 °C; a direction's degrees take no space. */
const withUnit = (text: string, unit: string) => (unit === "°" ? `${text}°` : `${text} ${unit}`);

$: options = HISTORY_WINDOWS.map((value) => ({ value, label: $_(`stations.history.window.${value}`) }));

/*
 * Its own width, as laid out. One plot box for every panel, so the line the
 * scrubber draws is at one time down the whole stack: as wide as the widest
 * scale's labels leave it, whichever panel they are on.
 */
let measured = 0;
$: chartWidth = measured || FALLBACK_WIDTH;
/** A tick label's width, near enough: tabular figures are a little over half the type's size. */
const labelWidth = (text: string) => text.length * TICK_PX * 0.6;
$: gutter = Math.ceil(Math.max(14, ...grids.flat().map((line) => labelWidth(line.label))) + TICK_GAP);
$: plot = { x0: 0, x1: chartWidth - gutter };

/** A time's x across a plot box, over a period. */
const timeScale = (over: { from: number; to: number } | null, box: { x0: number; x1: number }) => (t: number): number => {
  if (!over) return box.x0;
  return box.x0 + ((t - over.from) / (over.to - over.from)) * (box.x1 - box.x0);
};
/* Made again whenever the plot or the period moves, so every position
   worked out with it below is worked out again too. */
$: atX = timeScale(span, plot);

const valuesOf = (series: Series[]) => series.flatMap((one) => one.points.flatMap((point) => (point.v === null ? [] : [point.v])));

/** The panel's scale: fixed, from zero up to at least its floor, or read off its values. */
function scaleOf(panel: HistoryPanel, y0: number): Scale | null {
  if (panel.fixed) return fixedScale(panel.fixed.min, panel.fixed.max, panel.fixed.ticks, y0, TOP);
  const values = valuesOf(panel.series);
  if (panel.floor !== undefined) {
    const top = Math.max(panel.floor, ...values);
    const ticks = niceTicks(0, top, 3);
    // Up to a whole tick at or over the top, so the highest bar has a value above it.
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : top;
    while (ticks[ticks.length - 1] < top) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1000) / 1000);
    return fixedScale(0, ticks[ticks.length - 1], ticks, y0, TOP);
  }
  return verticalScale(values, y0, TOP, 3);
}

/** The newest value of the panel's own series, written at its end. */
function lastOf(panel: HistoryPanel): { t: number; v: number } | null {
  const own = panel.series.find((one) => one.style === "main" || one.style === "dots");
  const found = own ? [...own.points].reverse().find((point) => point.v !== null) : undefined;
  return found ? { t: found.t, v: found.v as number } : null;
}

/**
 * The figure a panel is read for, large in its caption: an amount's total
 * over the period (the rain that fell, the hours of sun), any other
 * quantity's newest value. The total's stat is then not repeated beside it.
 */
function figureOf(panel: HistoryPanel, last: { v: number } | null, language: string): { value: string; unit: string } | null {
  const total = panel.stats.find((one) => one.key === "total");
  if (total) {
    const hours = panel.key === "sunshine";
    return { value: number(total.value, hours ? 1 : panel.digits, language), unit: hours ? "h" : panel.unit };
  }
  if (!last) return null;
  if (panel.key === "direction") return { value: compass(last.v), unit: `${Math.round(last.v)}°` };
  return { value: number(last.v, panel.digits, language), unit: panel.unit };
}

const compass = (degrees: number) => $_(`storm.compass.${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8]}`);

$: panels = span ? historyPanels(rows).map((panel) => {
  const height = PANEL_H;
  const y0 = height - AXIS_ROOM;
  const scale = scaleOf(panel, y0);
  return { ...panel, height, y0, scale, last: lastOf(panel) };
}).flatMap((panel) => (panel.scale ? [{ ...panel, scale: panel.scale }] : [])) : [];

/* Each panel's scale, labelled: ahead of the positions, which need the room the labels take. */
$: grids = panels.map((panel) => panel.scale.ticks.map((value) => ({
  value,
  y: panel.scale.at(value),
  label: panel.key === "direction" ? $_(`storm.compass.${DIRECTION_TICKS[value]}`) : number(value, decimalsOf(panel.scale.ticks), lang),
})));

/*
 * Positions worked out here rather than in the markup, where Svelte would
 * not know they read `span`: as StormDetails' ticks, for the same reason.
 */
$: ticks = span ? historyTicks(span.from, span.to, currentLocale()).map((tick) => ({ ...tick, x: atX(tick.t) })) : [];
$: drawn = panels.map((panel, i) => ({
  grid: grids[i] ?? [],
  lines: panel.series.filter((one) => one.style === "main" || one.style === "context")
    .map((one) => ({ key: one.key, style: one.style, d: path(one.points, atX, panel.scale, MAX_GAP_MS) })),
  bars: panel.series.filter((one) => one.style === "bars").flatMap((one) => one.points.flatMap((point) => (
    point.v !== null && point.v > 0
      ? [{
        t: point.t,
        x: atX(point.t - ROW_MS),
        width: Math.max(atX(point.t) - atX(point.t - ROW_MS) - 0.3, 0.8),
        y: panel.scale.at(point.v),
        h: panel.scale.at(0) - panel.scale.at(point.v),
      }]
      : []))),
  dots: panel.series.filter((one) => one.style === "dots").flatMap((one) => one.points.flatMap((point) => (
    point.v === null ? [] : [{ t: point.t, x: atX(point.t), y: panel.scale.at(point.v) }]))),
}));

/** The decimals a scale's ticks need: none for 0, 10, 20; one for 0.2, 0.4. */
const decimalsOf = (ticks: number[]) => (ticks.some((tick) => !Number.isInteger(tick)) ? 1 : 0);

/**
 * "max 18,4 · min 7,0 · mean 9,9", less the total the figure already says.
 * In the figure's unit, which is written once, beside the figure, as the
 * system's Weather writes "H:20° L:10°": a unit after every number is what
 * ran the pressure's line off the edge. With no figure to carry it, each
 * number carries its own.
 */
const summaryOf = (panel: HistoryPanel, figure: { unit: string } | null, language: string) => panel.stats
  .filter((one) => one.key !== "total")
  .map((one) => statText(panel, one, figure?.unit !== panel.unit, language)).join(" · ");

/** One stat, with its unit when asked; sunshine's total in hours, as sunshine is told. */
function statText(panel: HistoryPanel, one: Stat, unit: boolean, language: string): string {
  const hours = panel.key === "sunshine" && one.key === "total";
  const sign = one.key === "change" && one.value > 0 ? "+" : "";
  const value = `${sign}${number(one.value, hours ? 1 : panel.digits, language)}`;
  return `${$_(`stations.history.stat.${one.key}`)} ${unit ? withUnit(value, hours ? "h" : panel.unit) : value}`;
}

/* ---- the scrubber ------------------------------------------------------ */

/*
 * A line across every panel at one row, its values written in place of each
 * caption's summary: what the station measured at a moment, read off all the
 * panels at once. A mouse moves it by hovering. A finger drags it sideways,
 * as the radar's timeline, and it stays where it is let go, so the values
 * can be read with the finger off the screen; a vertical drag is left to
 * the sheet and its scrolling, and a tap on the line takes it away again.
 */
$: times = rows.map((row) => Date.parse(row.observed_at));
/** The row the line is on, or null with none. */
let at: number | null = null;
let history: HTMLDivElement;
let pointer: number | null = null;
let downX = 0;
let downY = 0;
let axis: SwipeAxis = "undecided";

/** The row nearest a pointer's x, by the panels' shared time axis. */
function rowAt(clientX: number): number | null {
  const svg = history?.querySelector("svg");
  if (!svg || !span || !times.length) return null;
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * chartWidth;
  const t = span.from + ((x - plot.x0) / (plot.x1 - plot.x0)) * (span.to - span.from);
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < t) low = middle + 1;
    else high = middle;
  }
  return low > 0 && t - times[low - 1] < times[low] - t ? low - 1 : low;
}

function scrubTo(clientX: number): void {
  const row = rowAt(clientX);
  if (row === at) return;
  if (pointer !== null && row !== null) haptic("tick");
  at = row;
}

function onDown(event: PointerEvent): void {
  if (event.pointerType === "mouse") return;
  pointer = event.pointerId;
  downX = event.clientX;
  downY = event.clientY;
  axis = "undecided";
}

function onMove(event: PointerEvent): void {
  if (event.pointerType === "mouse") {
    scrubTo(event.clientX);
    return;
  }
  if (event.pointerId !== pointer) return;
  if (axis === "undecided") {
    axis = decideAxis(event.clientX - downX, event.clientY - downY);
    if (axis === "y") {
      pointer = null;
      return;
    }
    if (axis === "undecided") return;
    try { history.setPointerCapture(event.pointerId); } catch { /* already gone */ }
  }
  scrubTo(event.clientX);
}

function onUp(event: PointerEvent): void {
  if (event.pointerId !== pointer) return;
  pointer = null;
  if (axis !== "undecided") return;
  // A tap: the line to there, or away when it is tapped on.
  const row = rowAt(event.clientX);
  at = row !== null && at !== null && Math.abs(row - at) <= 2 ? null : row;
}

function onLeave(event: PointerEvent): void {
  if (event.pointerType === "mouse") at = null;
}

/** The moment the line is on: the clock, and the weekday over more than a day. */
function momentLabel(t: number): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (period !== "day") options.weekday = "short";
  return new Date(t).toLocaleString(currentLocale(), options);
}

const write = (value: number | null | undefined, panel: HistoryPanel, language: string) => (
  value === null || value === undefined ? "–" : withUnit(number(value, panel.digits, language), panel.unit));

/** The panel's own value at row `row`, for the figure while the line is out. */
function figureAt(panel: HistoryPanel, row: number, language: string): { value: string; unit: string } {
  const value = panel.series.find((one) => one.style !== "context")?.points[row]?.v;
  if (value === null || value === undefined) return { value: "–", unit: "" };
  if (panel.key === "direction") return { value: compass(value), unit: `${Math.round(value)}°` };
  return { value: number(value, panel.digits, language), unit: panel.unit };
}

/** Beside it, when that was and the context's value then: "14:20 · dew point 2,3 °C". */
function readout(panel: HistoryPanel, row: number, label: string, language: string): string {
  const parts = [label];
  for (const other of panel.series.filter((one) => one.style === "context")) {
    parts.push(`${$_(`stations.history.series.${other.key}`)} ${write(other.points[row]?.v, panel, language)}`);
  }
  return parts.join(" · ");
}

/** Where the line is drawn, and the dots it puts on each panel's lines. */
$: cursor = at !== null && times[at] !== undefined ? { x: atX(times[at]), label: momentLabel(times[at]) } : null;
$: marks = cursor && at !== null ? panels.map((panel) => panel.series
  .filter((one) => one.style === "main" || one.style === "context")
  .flatMap((one) => {
    const value = one.points[at as number]?.v;
    return value === null || value === undefined ? [] : [{ key: one.key, context: one.style === "context", y: panel.scale.at(value) }];
  })) : [];
</script>

<h3 class="section">{$_("stations.history.title")}</h3>
<div class="window">
  <Segmented {options} bind:value={period} label={$_("stations.history.window.group")} stretch />
</div>

{#if state === "loading"}
  <div class="skeleton"><ChartSkeleton bars={24} /></div>
{:else if state === "none" || !panels.length}
  <p class="none">{$_("stations.history.none")}</p>
{:else}
  <div
    class="history"
    class:scrubbing={cursor !== null}
    bind:this={history}
    bind:clientWidth={measured}
    on:pointerdown={onDown}
    on:pointermove={onMove}
    on:pointerup={onUp}
    on:pointercancel={onUp}
    on:pointerleave={onLeave}
    role="presentation">
    {#each panels as panel, panelIndex (panel.key)}
      {@const title = $_(`stations.history.panel.${panel.key}`)}
      {@const resting = figureOf(panel, panel.last, lang)}
      {@const reading = cursor && at !== null ? figureAt(panel, at, lang) : null}
      <figure class={panel.key}>
        <!-- The period's figure and the line's, laid over each other with the
             one not in use hidden: the caption is as tall as the taller of
             the two, so the chart under it never moves when the line comes
             out. Either may wrap its summary under the figure, which a long
             language needs for the pressure's three. -->
        <figcaption>
          <span class="name">{title}</span>
          <span class="figures">
            <span class="state" class:hidden={reading !== null}>
              {#if resting}
                <span class="figure">{resting.value}<span class="figure-unit">{resting.unit}</span></span>
              {/if}
              <span class="summary">{summaryOf(panel, resting, lang) || "\u00a0"}</span>
            </span>
            <span class="state reading" class:hidden={reading === null}>
              {#if reading && cursor && at !== null}
                <span class="figure">{reading.value}<span class="figure-unit">{reading.unit}</span></span>
                <span class="summary">{readout(panel, at, cursor.label, lang)}</span>
              {/if}
            </span>
          </span>
        </figcaption>
        <svg width={chartWidth} height={panel.height} viewBox="0 0 {chartWidth} {panel.height}" role="img"
             aria-label={$_("stations.history.aria", { values: { title, unit: panel.unit } })}>
          {#each drawn[panelIndex]?.grid ?? [] as line (line.value)}
            <line class="grid" x1={plot.x0} x2={plot.x1} y1={line.y} y2={line.y} />
            <text class="tick scale" x={plot.x1 + TICK_GAP} y={line.y}>{line.label}</text>
          {/each}

          {#each ticks as mark, i (mark.t)}
            <line class="vgrid" x1={mark.x} x2={mark.x} y1={panel.y0} y2={TOP} />
            <text class="tick" x={mark.x} y={panel.y0 + 14}
                  text-anchor={i === 0 && mark.x - plot.x0 < 12 ? "start"
                    : (i === ticks.length - 1 && plot.x1 - mark.x < 12 ? "end" : "middle")}>
              {mark.label}
            </text>
          {/each}

          <line class="axis" x1={plot.x0} x2={plot.x1} y1={panel.y0} y2={panel.y0} />

          {#each drawn[panelIndex]?.bars ?? [] as bar (bar.t)}
            <rect class="bar" x={bar.x} y={bar.y} width={bar.width} height={bar.h} />
          {/each}
          {#each drawn[panelIndex]?.lines ?? [] as line (line.key)}
            <path class="trace" class:context={line.style === "context"} d={line.d} fill="none" />
          {/each}
          {#each drawn[panelIndex]?.dots ?? [] as dot (dot.t)}
            <circle class="dot" cx={dot.x} cy={dot.y} r="1.3" />
          {/each}

          {#if cursor}
            <line class="cursor" x1={cursor.x} x2={cursor.x} y1={TOP - 4} y2={panel.y0} />
            {#each marks[panelIndex] ?? [] as mark (mark.key)}
              <circle class="mark" class:context={mark.context} cx={cursor.x} cy={mark.y} r="3" />
            {/each}
          {/if}

          {#if panel.last && panel.key !== "direction" && !cursor}
            <circle class="head" cx={atX(panel.last.t)} cy={panel.scale.at(panel.last.v)} r="3" />
          {/if}
        </svg>
      </figure>
    {/each}
  </div>
{/if}

<style>
  .window {
    margin: 0 0 16px;
  }
  .skeleton {
    height: 140px;
  }
  .none {
    margin: 0;
    color: var(--mc-text-2);
  }

  /* Each panel's colour, as the parameter is drawn on the map where it can
     be: the temperature warm, the rain the accent's blue, the sun yellow. */
  /* Air between the panels rather than rules, as the sheet's groups are set. */
  figure { --ink: currentColor; margin: 0 0 18px; }
  figure:last-child { margin-bottom: 4px; }
  .temperature { --ink: var(--mc-red); }
  .precipitation { --ink: var(--mc-accent); }
  .sunshine { --ink: #ffcc00; }
  .humidity { --ink: var(--mc-brand); }
  .pressure { --ink: var(--mc-accent); }
  .wind { --ink: var(--mc-orange); }

  /* The caption as Health and Weather set one: the name small in the
     secondary ink, the figure under it large, what sums the period up
     beside the figure on its baseline, quieter. */
  figcaption {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 6px;
    min-width: 0;
  }
  .name {
    font: var(--mc-type-label);
    color: var(--mc-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .figures {
    display: grid;
    min-width: 0;
    /* The figure's line box, held with no figure in it too. */
    min-height: 25px;
  }
  .state {
    grid-area: 1 / 1;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
    min-width: 0;
  }
  .state.hidden {
    visibility: hidden;
  }
  .figure {
    flex: 0 0 auto;
    font: 600 22px/1.15 var(--mc-font);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--mc-text);
  }
  .figure-unit {
    margin-left: 3px;
    font: 500 13px/1 var(--mc-font);
    letter-spacing: 0;
    color: var(--mc-text-2);
  }
  .summary {
    flex: 0 1 auto;
    min-width: 0;
    font: 400 13px/1.25 var(--mc-font);
    color: var(--mc-text-2);
    font-variant-numeric: tabular-nums;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: currentColor;
    stroke-opacity: 0.12;
    stroke-width: 1;
  }
  .axis {
    stroke: currentColor;
    stroke-opacity: 0.3;
    stroke-width: 1;
  }
  /* The time ticks, faint, run each panel's height, so a moment can be
     followed down the stack. */
  .vgrid {
    stroke: currentColor;
    stroke-opacity: 0.12;
    stroke-width: 1;
  }

  /* Sideways drags are the scrubber's; vertical ones scroll the sheet. */
  .history {
    width: 100%;
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
  }
  .cursor {
    stroke: currentColor;
    stroke-opacity: 0.7;
    stroke-width: 1;
  }
  .mark {
    fill: var(--ink);
    stroke: var(--mc-sheet-card, #1c1c1e);
    stroke-width: 1.5;
  }
  .mark.context {
    fill: currentColor;
  }
  /* While the line is out the figure is the line's: in the panel's ink, so
     it reads as a reading and not as the newest value. */
  .state.reading .figure {
    color: var(--ink);
  }
  .tick {
    font: 400 10px/1 var(--mc-font);
    fill: var(--mc-text-2);
    font-variant-numeric: tabular-nums;
  }
  .scale { text-anchor: start; dominant-baseline: middle; }
  .trace {
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* The second quantity (dew point, gusts): plain ink, thinner, as context. */
  .trace.context {
    stroke: currentColor;
    stroke-opacity: 0.45;
    stroke-width: 1.25;
  }
  .bar {
    fill: var(--ink);
    shape-rendering: crispEdges;
  }
  .dot {
    fill: currentColor;
    fill-opacity: 0.7;
  }
  .head {
    fill: var(--ink);
  }
</style>
