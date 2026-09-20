<script lang="ts">
/**
 * What one tracked thunderstorm has been doing.
 *
 * A cell's current reflectivity says very little on its own: a 55 dBZ core that
 * has been weakening for twenty minutes and one that has doubled its VIL in ten
 * are the same number and completely different storms. So this leads with the
 * signatures that separate a severe storm from a heavy shower -- rotation,
 * hail, a lightning jump, motion that departs from everything nearby -- shows
 * the storm's own shape as a turning 3D model, and plots the history behind the
 * current reading.
 */
import { _ } from "svelte-i18n";
import { selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import CellModel3D from "./CellModel3D.svelte";
import type { CellTrackProperties } from "../api";
import type { VolumeInput } from "../lib/cellVolume";

export let track: CellTrackProperties;

const SEVERITY_NAMES = ["weak", "moderate", "strong", "extreme"];
/** Below this, a heading differs from its neighbours by less than the noise. */
const DEVIANT_DEGREES = 30;

const round = (value: number | null | undefined, digits = 0): string => (
  value === null || value === undefined ? "–" : Number(value).toFixed(digits)
);

const clock = (iso: string): string => new Date(iso)
  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const compass = (deg: number | null | undefined): string => (
  deg === null || deg === undefined ? "–" : COMPASS[Math.round(deg / 22.5) % 16]
);

/* ---- the history chart ------------------------------------------------- */

/**
 * A chart, not a sparkline.
 *
 * The earlier version drew a bare path with no scale on it, which can say
 * "went up a bit" and nothing more -- a rise from 48 to 52 dBZ and one from 30
 * to 62 drew the identical line, because both were normalised to the box. With
 * labelled axes the same forty pixels carry the actual numbers, and the second
 * series makes the pair readable together: reflectivity climbing while the echo
 * top collapses is a storm raining itself out, and the two lines cross.
 *
 * Still hand-drawn rather than handed to a chart library. This is one popup
 * with two dozen points in it, and the app already pays for one map renderer.
 */
const CHART = {
  width: 336, height: 122, left: 30, right: 34, top: 10, bottom: 22,
};

const plot = {
  x0: CHART.left,
  x1: CHART.width - CHART.right,
  y0: CHART.height - CHART.bottom,
  y1: CHART.top,
};

/** Tick values at 1, 2, 2.5 or 5 times a power of ten, whichever fits. */
function niceTicks(min: number, max: number, target = 4): number[] {
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

interface Scale {
  min: number;
  max: number;
  ticks: number[];
  at: (value: number) => number;
}

/** A vertical scale over `values`, padded out to whole ticks. */
function verticalScale(values: number[], y0: number, y1: number, target = 4): Scale | null {
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

/** Points along a series, skipping steps where that series is missing. */
function path(
  steps: Array<{ t: number; v: number | null | undefined }>,
  atX: (t: number) => number,
  scale: Scale | null,
): string {
  if (!scale) return "";
  let open = false;
  return steps
    .map(({ t, v }) => {
      if (v === null || v === undefined || !Number.isFinite(v)) {
        open = false;
        return "";
      }
      const command = open ? "L" : "M";
      open = true;
      return `${command}${atX(t).toFixed(1)},${scale.at(v).toFixed(1)}`;
    })
    .join("");
}

$: severity = Math.min(Math.max(track.max_severity, 0), 3);
$: colour = severityColour(severity);
$: series = track.series ?? [];
$: latest = series[series.length - 1];
$: forecast = track.forecast ?? [];

$: times = series.map((step) => new Date(step.t).getTime());
$: span = times.length > 1
  ? { from: times[0], to: times[times.length - 1] }
  : null;
/**
 * Time to an x position, over the window the series covers.
 *
 * Plotted against the clock rather than against the index, so a gap in the
 * radar record shows as a gap rather than being closed up into a steady line.
 */
function atX(t: number): number {
  if (!span || span.to <= span.from) return plot.x0;
  return plot.x0 + ((t - span.from) / (span.to - span.from)) * (plot.x1 - plot.x0);
}

$: dbzScale = verticalScale(
  series.map((step) => step.max_dbz).filter((v): v is number => v != null),
  plot.y0,
  plot.y1,
  4,
);
$: topScale = verticalScale(
  series.map((step) => (step.echo_top_m ?? NaN) / 1000).filter((v) => Number.isFinite(v)),
  plot.y0,
  plot.y1,
  3,
);
$: dbzPath = path(series.map((s, i) => ({ t: times[i], v: s.max_dbz })), atX, dbzScale);
$: topPath = path(
  series.map((s, i) => ({ t: times[i], v: s.echo_top_m == null ? null : s.echo_top_m / 1000 })),
  atX,
  topScale,
);
/** Start, middle and end: enough to read the window without crowding the axis. */
$: timeTicks = span
  ? [span.from, (span.from + span.to) / 2, span.to]
  : [];

/** The current detection, in the shape the volumetric model reads. */
$: shape = latest && (track.structure ?? []).length
  ? ({
    code: track.code,
    lon: latest.lon,
    lat: latest.lat,
    echo_bottom_m: track.echo_bottom_m,
    polygon: track.polygon,
    structure: track.structure,
  } satisfies VolumeInput)
  : null;

/** Minutes up to an hour, then hours: "127 min" is not a duration anyone reads. */
function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

$: age = duration((Date.now() - new Date(track.first_seen).getTime()) / 60_000);
</script>

<div class="cell-details">
  <header style="border-color: {colour}">
    <span class="severity">{SEVERITY_NAMES[severity]}</span>
    <span class="age">{age}</span>
    {#if !track.active}<span class="age">dissipated</span>{/if}
    <button class="close" on:click={() => selectedCell.set(null)} aria-label="Close">&times;</button>
  </header>

  <div class="signals">
    {#if track.meso_ever}
      <span class="signal rotating">
        rotating{track.meso_minutes ? ` ${duration(track.meso_minutes)}` : ""}
      </span>
    {/if}
    {#if track.hail_ever}
      <span class="signal hail">
        hail{track.hail_minutes ? ` ${duration(track.hail_minutes)}` : ""}
      </span>
    {/if}
    {#if track.lightning_jump_recent}<span class="signal jump">lightning jump</span>{/if}
    {#if track.intensifying}<span class="signal up">intensifying</span>{/if}
    {#if track.split_ever}<span class="signal lineage">split</span>{/if}
    {#if track.merge_ever}<span class="signal lineage">merged</span>{/if}
    {#if track.deviation_deg !== null && track.deviation_deg !== undefined
      && track.deviation_deg > DEVIANT_DEGREES}
      <span class="signal deviant">deviant {round(track.deviation_deg)}&deg;</span>
    {/if}
  </div>

  {#if shape}
    <figure class="model">
      <CellModel3D cell={shape} width={CHART.width} height={200} />
      <figcaption>structure now &middot; drag to turn</figcaption>
    </figure>
  {/if}

  <dl>
    <div><dt>peak</dt><dd>{round(track.max_dbz, 1)} dBZ</dd></div>
    <div><dt>echo top</dt><dd>{round((track.echo_top_max_m ?? 0) / 1000, 1)} km</dd></div>
    <div><dt>VIL</dt><dd>{round(track.vil_max, 1)} kg/m&sup2;</dd></div>
    {#if latest}
      <div><dt>motion</dt><dd>{round(latest.speed_kmh)} km/h {compass(latest.heading_deg)}</dd></div>
      {#if latest.gust_kmh}<div><dt>gusts</dt><dd>{round(latest.gust_kmh)} km/h</dd></div>{/if}
      {#if latest.lightning_rate}
        <div><dt>lightning</dt><dd>{latest.lightning_rate}/5 min</dd></div>
      {/if}
    {/if}
  </dl>

  {#if span && dbzScale}
    <figure class="history">
      <figcaption>
        <span class="key"><span class="swatch" style="background: {colour}"></span>reflectivity</span>
        {#if topScale}
          <span class="key"><span class="swatch dashed"></span>echo top</span>
        {/if}
      </figcaption>
      <svg viewBox="0 0 {CHART.width} {CHART.height}" role="img"
           aria-label="Reflectivity and echo top over the tracked period">
        {#each dbzScale.ticks as value (value)}
          <line class="grid" x1={plot.x0} x2={plot.x1}
                y1={dbzScale.at(value)} y2={dbzScale.at(value)} />
          <text class="tick left" x={plot.x0 - 5} y={dbzScale.at(value)}>{value}</text>
        {/each}

        {#if topScale}
          {#each topScale.ticks as value (value)}
            <line class="tickmark" x1={plot.x1} x2={plot.x1 + 3}
                  y1={topScale.at(value)} y2={topScale.at(value)} />
            <text class="tick right" x={plot.x1 + 6} y={topScale.at(value)}>{value}</text>
          {/each}
        {/if}

        {#each timeTicks as t (t)}
          <line class="tickmark" x1={atX(t)} x2={atX(t)} y1={plot.y0} y2={plot.y0 + 3} />
          <text class="tick time" x={atX(t)} y={plot.y0 + 13}>{clock(new Date(t).toISOString())}</text>
        {/each}

        <line class="axis" x1={plot.x0} x2={plot.x0} y1={plot.y0} y2={plot.y1} />
        <line class="axis" x1={plot.x0} x2={plot.x1} y1={plot.y0} y2={plot.y0} />
        {#if topScale}
          <line class="axis" x1={plot.x1} x2={plot.x1} y1={plot.y0} y2={plot.y1} />
        {/if}

        <text class="unit" x={plot.x0 - 5} y={plot.y1 - 2}>dBZ</text>
        {#if topScale}<text class="unit end" x={plot.x1 + 6} y={plot.y1 - 2}>km</text>{/if}

        {#if topPath}
          <path class="top" d={topPath} fill="none" />
        {/if}
        <path d={dbzPath} fill="none" stroke={colour} stroke-width="1.6"
              stroke-linejoin="round" stroke-linecap="round" />
      </svg>
    </figure>
  {/if}

  {#if track.active && forecast.length}
    <footer>
      forecast to {clock(forecast[forecast.length - 1].t)},
      &plusmn;{round(forecast[forecast.length - 1].major_km, 1)} km
    </footer>
  {/if}
</div>

<style>
  .cell-details {
    font-size: 13px;
    line-height: 1.45;
    min-width: 300px;
    max-width: 360px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    border-left: 4px solid;
    padding-left: 8px;
    margin-bottom: 6px;
  }
  .severity {
    font-weight: 600;
    text-transform: capitalize;
  }
  .age {
    font-size: 11px;
    opacity: 0.65;
  }
  .close {
    margin-left: auto;
    border: 0;
    background: none;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    color: inherit;
    opacity: 0.5;
  }
  .signals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .signal {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 9px;
    background: rgba(128, 128, 128, 0.18);
    white-space: nowrap;
  }
  .rotating { background: rgba(156, 54, 181, 0.22); }
  .hail { background: rgba(224, 49, 49, 0.22); }
  .jump { background: rgba(240, 180, 41, 0.26); }
  .deviant { background: rgba(31, 110, 200, 0.2); }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    margin: 0 0 6px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  dt { opacity: 0.6; }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  figure { margin: 0 0 6px; }
  .model {
    border-radius: 8px;
    background: rgba(128, 128, 128, 0.08);
    overflow: hidden;
  }
  figcaption {
    font-size: 10px;
    opacity: 0.55;
    margin-bottom: 2px;
  }
  .model figcaption {
    margin: 0 0 4px 8px;
  }
  .history figcaption {
    display: flex;
    gap: 10px;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .swatch {
    width: 10px;
    height: 2px;
    border-radius: 1px;
    display: inline-block;
  }
  .swatch.dashed {
    background: repeating-linear-gradient(
      90deg, currentColor 0 3px, transparent 3px 5px
    );
  }
  svg {
    width: 100%;
    height: auto;
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
    stroke-opacity: 0.35;
    stroke-width: 1;
  }
  .tickmark {
    stroke: currentColor;
    stroke-opacity: 0.35;
    stroke-width: 1;
  }
  .tick {
    font-size: 9px;
    fill: currentColor;
    fill-opacity: 0.6;
    font-variant-numeric: tabular-nums;
  }
  .left { text-anchor: end; dominant-baseline: middle; }
  .right { text-anchor: start; dominant-baseline: middle; }
  .time { text-anchor: middle; }
  .unit {
    font-size: 9px;
    fill: currentColor;
    fill-opacity: 0.45;
    text-anchor: end;
  }
  .unit.end { text-anchor: start; }
  .top {
    stroke: currentColor;
    stroke-opacity: 0.55;
    stroke-width: 1.2;
    stroke-dasharray: 3 3;
  }
  footer {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
