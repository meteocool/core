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
import { onDestroy } from "svelte";
import { capLatestObservation, cellDetails, selectedCell, smallScreen } from "../stores";
import { afterClose } from "../lib/cellSelection";
import { cellRecency, radarOffsetLabel } from "../lib/cellRecency";
import { severityColour } from "../layers/cells";
import CellModel3D from "./CellModel3D.svelte";
import { BAND_NAMES, cellReadings, duration } from "../lib/cellMetrics";
import type { CellTrackProperties } from "../api";
import type { VolumeInput } from "../lib/cellVolume";

export let track: CellTrackProperties;

/** Below this, a heading differs from its neighbours by less than the noise. */
const DEVIANT_DEGREES = 30;

const round = (value: number | null | undefined, digits = 0): string => (
  value === null || value === undefined ? "–" : Number(value).toFixed(digits)
);

/**
 * 24-hour, always.
 *
 * Radar timestamps, model runs and DWD's own products are all written that
 * way, and a popup that says 03:10 PM beside a strip labelled 15:10 makes the
 * reader do the conversion to check they are the same moment.
 */
const clock = (iso: string): string => new Date(iso)
  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const compass = (deg: number | null | undefined): string => (
  deg === null || deg === undefined ? "–" : COMPASS[Math.round(deg / 22.5) % 16]
);

/* ---- the history chart ------------------------------------------------- */

/**
 * Two charts, not one with two scales.
 *
 * The first version of this drew reflectivity against a left axis and echo top
 * against a right one. That is the oldest bad habit in charting: where the two
 * scales line up is a choice, so the crossing point where the lines meet is
 * something the chart invents rather than something the storm did. Stacked as
 * small multiples over one shared clock they answer the same question -- is the
 * core strengthening while the cloud collapses? -- without either line being
 * able to lie about the other.
 *
 * The earlier version before that was a bare sparkline with no scale at all,
 * which can say "went up a bit" and nothing more: a rise from 48 to 52 dBZ and
 * one from 30 to 62 drew the identical line, because both were normalised to
 * the box.
 *
 * Still hand-drawn rather than handed to a chart library. This is one popup
 * with two dozen points in it, and the app already pays for one map renderer.
 */
const CHART = {
  width: 336, left: 28, right: 38, top: 9,
};

/** Room for the time labels, on the lower chart only. */
const AXIS_ROOM = 16;

const plot = { x0: CHART.left, x1: CHART.width - CHART.right };

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
/** The last detection: everything left of it happened, everything right of it has not. */
$: now = times.length ? times[times.length - 1] : null;
$: horizon = track.active && forecast.length
  ? new Date(forecast[forecast.length - 1].t).getTime()
  : null;

/**
 * The window the charts cover: what was observed, plus where the cell is
 * predicted to be.
 *
 * Running the axis past the last detection rather than stopping at it is what
 * lets the two be told apart at all. Radar reports no intensity forecast --
 * only where the centroid is going and how uncertain that is -- so the traces
 * genuinely stop at `now`, and a chart that ended there too would leave a
 * reader to guess whether the last value is current or predicted. With the
 * lead time drawn and shaded, the answer is on the page.
 */
$: span = times.length > 1
  ? { from: times[0], to: Math.max(times[times.length - 1], horizon ?? 0) }
  : null;

/**
 * Time to an x position, over the window the charts cover.
 *
 * Plotted against the clock rather than against the index, so a gap in the
 * radar record shows as a gap rather than being closed up into a steady line.
 */
function atX(t: number): number {
  if (!span || span.to <= span.from) return plot.x0;
  return plot.x0 + ((t - span.from) / (span.to - span.from)) * (plot.x1 - plot.x0);
}

/** Where the shaded band starts, or null when there is nothing to predict. */
$: forecastFrom = now !== null && horizon !== null && horizon > now ? now : null;

/**
 * The two panels.
 *
 * Reflectivity leads in the cell's own severity colour, echo top follows in
 * plain ink: one series is the point and the other is context, which is
 * emphasis rather than two colours competing. Each panel is a single series,
 * so it needs no legend -- its caption names it -- and the latest value is
 * labelled on the line instead of every point carrying a number.
 */
$: panels = [
  {
    key: "dbz",
    title: "reflectivity",
    unit: "dBZ",
    height: 62,
    axis: false,
    digits: 0,
    values: series.map((step) => step.max_dbz ?? null),
    accent: true,
    // The two regions are named once, on the upper panel: it has the clear
    // headroom, and the lower one's top gridline label sits where the first
    // caption would go.
    legend: true,
  },
  {
    key: "top",
    title: "echo top",
    unit: "km",
    height: 58,
    axis: true,
    digits: 1,
    values: series.map((step) => (step.echo_top_m == null ? null : step.echo_top_m / 1000)),
    accent: false,
    legend: false,
  },
].map((panel) => {
  const bottom = panel.axis ? AXIS_ROOM : 5;
  const y0 = panel.height - bottom;
  const scale = verticalScale(
    panel.values.filter((v): v is number => v !== null),
    y0,
    CHART.top,
    3,
  );
  const points = panel.values.map((v, i) => ({ t: times[i], v }));
  const lastAt = [...panel.values].reduce<number>(
    (found, v, i) => (v === null ? found : i),
    -1,
  );
  return {
    ...panel,
    y0,
    scale,
    path: path(points, atX, scale),
    last: lastAt >= 0 ? { t: times[lastAt], v: panel.values[lastAt] as number } : null,
  };
  // `flatMap` rather than `filter`, so a panel whose series is missing drops
  // out with its `scale` narrowed to non-null for everything downstream.
}).flatMap((panel) => (panel.scale ? [{ ...panel, scale: panel.scale }] : []));

/**
 * The three moments worth labelling: where the record starts, now, and how far
 * the forecast runs. A midpoint tick says less than the boundary between what
 * happened and what has not.
 */
$: timeTicks = span
  ? [...new Set([span.from, now ?? span.to, span.to])].filter((t): t is number => t !== null)
  : [];

$: readings = cellReadings(track, compass);

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


$: age = duration((Date.now() - new Date(track.first_seen).getTime()) / 60_000);

/* ---- how current any of this is ---------------------------------------- */

/**
 * A clock of our own, because everything below is relative to now and nothing
 * else on the page ticks.
 *
 * Every quarter minute: the readings are five-minutely, so a slower tick would
 * let "4 min ago" sit there while it became six, and a faster one would redraw
 * the panel to change nothing. Cleared on destroy -- this component is created
 * and thrown away on every tap.
 */
let tick = Date.now();
const clockTimer = setInterval(() => { tick = Date.now(); }, 15_000);
onDestroy(() => clearInterval(clockTimer));

$: recency = cellRecency(
  new Date(track.last_seen).getTime(),
  tick,
  $capLatestObservation > 0 ? $capLatestObservation * 1000 : null,
);
$: radarOffset = radarOffsetLabel(recency.behindMinutes);
$: observedAt = clock(track.last_seen);

/**
 * Closing leaves the cell's forecast on the map on a phone, and clears it
 * everywhere else.
 *
 * There, closing the panel is how a reader asks to look at the map again --
 * the panel was covering it -- so taking the forecast away with it would mean
 * tapping the storm twice over to get back what they were already looking at.
 * The map background still clears everything, which is where "done with this
 * storm" belongs. `afterClose` in lib/cellSelection.ts states both.
 */
function close() {
  const next = afterClose({ code: track.code, details: true }, $smallScreen);
  if (!next.code) selectedCell.set(null);
  cellDetails.set(next.details);
}
</script>

<div class="cell-details">
  <header style="border-color: {colour}">
    <span class="severity">{BAND_NAMES[severity]}</span>
    <span class="age">{age}</span>
    {#if !track.active}<span class="age">dissipated</span>{/if}
    <button class="close" on:click={close} aria-label="Close">&times;</button>
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
      <figcaption>structure at {observedAt} &middot; drag to turn</figcaption>
    </figure>
  {/if}

  <ul class="metrics">
    {#each readings as item (item.key)}
      <li class="metric" data-band={item.band ?? "none"} title={item.bandName ?? ""}>
        <span class="name">{item.label}</span>
        <span class="value">{item.text}</span>
        <!-- The meter is the reading again as a length. Colour alone would
             leave the bands unreadable to anyone who cannot separate the
             hues, and this popup has no room to spell the class out six
             times over. -->
        <span class="meter"><span class="fill" style="width: {item.fill * 100}%"></span></span>
        {#if item.bandName}<span class="sr-only">{item.bandName}</span>{/if}
      </li>
    {/each}
  </ul>

  {#if span && panels.length}
    <div class="history">
      {#each panels as panel (panel.key)}
        <figure>
          <figcaption>{panel.title}, {panel.unit}</figcaption>
          <svg viewBox="0 0 {CHART.width} {panel.height}" role="img"
               aria-label="{panel.title} over the tracked period, in {panel.unit}">
            <!-- The lead time, shaded. Radar forecasts a cell's position, not
                 its intensity, so no trace crosses into this band: it marks
                 where the record stops rather than hiding a prediction. -->
            {#if forecastFrom !== null}
              <rect class="ahead" x={atX(forecastFrom)} y={CHART.top}
                    width={plot.x1 - atX(forecastFrom)} height={panel.y0 - CHART.top} />
              <line class="nowline" x1={atX(forecastFrom)} x2={atX(forecastFrom)}
                    y1={CHART.top} y2={panel.y0} />
            {/if}

            {#each panel.scale.ticks as value (value)}
              <line class="grid" x1={plot.x0} x2={plot.x1}
                    y1={panel.scale.at(value)} y2={panel.scale.at(value)} />
              <text class="tick left" x={plot.x0 - 5} y={panel.scale.at(value)}>{value}</text>
            {/each}

            {#each timeTicks as t (t)}
              <line class="tickmark" x1={atX(t)} x2={atX(t)}
                    y1={panel.y0} y2={panel.y0 + (panel.axis ? 3 : 0)} />
              {#if panel.axis}
                <text class="tick time" x={atX(t)} y={panel.y0 + 13}>
                  {clock(new Date(t).toISOString())}
                </text>
              {/if}
            {/each}

            <line class="axis" x1={plot.x0} x2={plot.x0} y1={panel.y0} y2={CHART.top} />
            <line class="axis" x1={plot.x0} x2={plot.x1} y1={panel.y0} y2={panel.y0} />

            {#if panel.legend && forecastFrom !== null}
              <text class="region" x={plot.x0 + 2} y={CHART.top + 6}>observed</text>
              <text class="region" x={atX(forecastFrom) + 3} y={CHART.top + 6}>forecast</text>
            {/if}

            <path class="trace" class:context={!panel.accent} d={panel.path} fill="none"
                  stroke={panel.accent ? colour : undefined} />
            {#if panel.last}
              <circle class="head" class:context={!panel.accent}
                      cx={atX(panel.last.t)} cy={panel.scale.at(panel.last.v)} r="2.6"
                      fill={panel.accent ? colour : undefined} />
              <text class="direct" x={plot.x1 + 5} y={panel.scale.at(panel.last.v)}>
                {panel.last.v.toFixed(panel.digits)}
              </text>
            {/if}
          </svg>
        </figure>
      {/each}
    </div>
  {/if}

  <footer class="recency" class:offset={radarOffset !== null}>
    <span>
      observed {observedAt} &middot; {duration(recency.ageMinutes)} ago
    </span>
    {#if radarOffset}<span class="behind">{radarOffset}</span>{/if}
  </footer>

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
  /* Everything above is one detection, and the panel used to imply it was
     current. The second half is the one that decides whether the numbers can
     be read against the radar drawn behind them at all, so it is marked when
     it appears and absent when the two are in step. */
  .recency {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    /* Colour rather than the footer's opacity, so the clause below can be
       louder than the line it sits in; opacity on a parent cannot be undone. */
    opacity: 1;
    color: var(--sl-color-neutral-500, #78716c);
  }
  .recency .behind {
    color: var(--mc-orange, #d97706);
    font-weight: 600;
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

  /* A thumb needs 44px; a mouse does not, and at desktop size a target that
     big beside a 13px heading is the loudest thing in the panel. */
  @media only screen and (max-width: 620px) {
    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      margin: -8px -8px -8px auto;
      border-radius: 50%;
      font-size: 26px;
      opacity: 0.55;
    }
    header {
      align-items: center;
    }
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
  /*
   * The four DWD severity classes, as a fill for the meter and a darker step
   * of the same hue for the figure beside it.
   *
   * Two steps per band rather than one because the fill and the figure are
   * held to different bars: a bar of colour needs to be seen, a numeral needs
   * to be read. Amber at the weight that reads correctly as a fill sits near
   * 1.9:1 against white -- fine behind a bar, illegible as a digit -- so the
   * figures wear steps measured to clear 4.5:1 against each of the two
   * surfaces this panel actually uses, rather than one compromise step that is
   * wrong on both.
   */
  .metric[data-band="0"] { --band: #2f9e44; --band-ink: #1b7a31; }
  .metric[data-band="1"] { --band: #f0b429; --band-ink: #8a5e05; }
  .metric[data-band="2"] { --band: #e03131; --band-ink: #b02020; }
  .metric[data-band="3"] { --band: #9c36b5; --band-ink: #7a219a; }
  .metric[data-band="none"] { --band: currentColor; --band-ink: currentColor; }

  /* Keyed to the class ui.ts toggles rather than to prefers-color-scheme: the
     app's own theme switch has to win over the system on iOS and Android. */
  :global(html.sl-theme-dark) .metric[data-band="0"] { --band-ink: #57c96a; }
  :global(html.sl-theme-dark) .metric[data-band="1"] { --band-ink: #f5c95c; }
  :global(html.sl-theme-dark) .metric[data-band="2"] { --band-ink: #ff8585; }
  :global(html.sl-theme-dark) .metric[data-band="3"] { --band-ink: #d68bea; }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px 14px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .metric {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 0 6px;
  }
  .name {
    opacity: 0.6;
    font-size: 11px;
  }
  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--band-ink);
    font-weight: 600;
    white-space: nowrap;
  }
  .meter {
    grid-column: 1 / -1;
    height: 3px;
    margin-top: 3px;
    border-radius: 2px;
    /* A light step of the same hue, so the band reads across the whole track
       and not only across the filled part of it. The neutral underneath is
       for engines without `color-mix`: the track still shows how long the
       bar could be, which is the part that has to survive. */
    background: rgba(128, 128, 128, 0.16);
    background: color-mix(in srgb, var(--band) 20%, transparent);
    overflow: hidden;
  }
  .metric[data-band="none"] .meter { background: rgba(128, 128, 128, 0.16); }
  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--band);
  }
  /* The class name in words. Colour is the glance and the meter is the
     fallback for anyone it does not reach, but a screen reader gets neither. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
  /* The lead time. Kept very light: it is a region, not a mark, and it sits
     behind the gridlines rather than competing with them. */
  .ahead {
    fill: currentColor;
    fill-opacity: 0.09;
  }
  .nowline {
    stroke: currentColor;
    stroke-opacity: 0.4;
    stroke-width: 1;
    stroke-dasharray: 2 2;
  }
  .region {
    font-size: 8px;
    fill: currentColor;
    fill-opacity: 0.45;
    text-transform: uppercase;
    letter-spacing: 0.04em;
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
  .time { text-anchor: middle; }
  footer {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
