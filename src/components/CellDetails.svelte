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
import { SvelteMap } from "svelte/reactivity";
import { capLatestObservation, cellDetails, selectedCell, smallScreen } from "../stores";
import { afterClose } from "../lib/cellSelection";
import { cellRecency, radarOffsetLabel } from "../lib/cellRecency";
import { MAX_FAMILY, missingRelatives } from "../lib/cellLineage";
import { timeTicks } from "../lib/timeTicks";
import { fetchCellTrack } from "../api";
import CellLineage from "./CellLineage.svelte";
import { severityColour } from "../layers/cells";
import CellModel3D from "./CellModel3D.svelte";
import { BAND_NAMES, cellReadings, duration } from "../lib/cellMetrics";
import type { CellStep, CellTrackProperties } from "../api";
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

$: times = series.map((step) => new Date(step.t).getTime());

/**
 * Every cell of the family, so the charts can show what this one came out of.
 *
 * Ordered so the drawing is stable as the panel is walked, for the reason
 * spelled out on `buildLineage`: the traversal order depends on which cell is
 * open, and a chart whose faint lines reshuffle on every hop is worse than one
 * without them.
 */
$: relatives = [...family.values()]
  .filter((other) => other.code !== track.code && (other.series ?? []).length > 1)
  .sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.code.localeCompare(b.code));

/**
 * The window the charts cover: the family's, not just this cell's.
 *
 * It used to run past the last detection to a shaded lead time. That band is
 * gone -- radar forecasts a cell's position and not its intensity, so there
 * was never a trace to mark the start of, and an empty third of the chart was
 * paying for a distinction the axis labels can make on their own.
 *
 * What the window covers instead is every cell drawn on it. A merge is two
 * traces ending where a third takes over, and it only reads that way if all of
 * them are on one clock.
 */
$: familyTimes = relatives.flatMap((other) => (other.series ?? [])
  .map((step) => new Date(step.t).getTime()));
/**
 * The window runs to now, not to the last reading.
 *
 * Which is the whole point of marking it. A cell's readings stop when DWD
 * stopped detecting it, and a chart that ends there quietly implies the record
 * is current -- the trace runs to the right-hand edge whether it was measured
 * a minute ago or an hour. Carrying the axis to the present puts the gap on
 * the page, where the `now` line then says what it is.
 *
 * `tick` rather than `Date.now()` so the line moves: it is the same
 * quarter-minute clock the "6 min ago" reading runs on, so the two cannot
 * disagree about what time it is.
 */
$: span = (() => {
  if (times.length < 2) return null;
  const from = Math.min(times[0], ...familyTimes);
  const end = Math.max(times[times.length - 1], ...familyTimes, tick);
  // A little past the end, so `now` lands inside the plot with a gap after it
  // rather than on the axis line. Without this the marker is always exactly on
  // the right-hand edge -- carrying the window to now makes now the edge by
  // construction -- and an invisible line is not a mark.
  return { from, to: end + (end - from) * 0.05 };
})();

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
    pick: (step: CellStep) => step.max_dbz ?? null,
    accent: true,
  },
  {
    key: "top",
    title: "echo top",
    unit: "km",
    height: 58,
    axis: true,
    digits: 1,
    pick: (step: CellStep) => (step.echo_top_m == null ? null : step.echo_top_m / 1000),
    accent: false,
  },
].map((spec) => ({ ...spec, values: series.map(spec.pick) })).map((panel) => {
  const bottom = panel.axis ? AXIS_ROOM : 5;
  const y0 = panel.height - bottom;
  /*
   * The family's readings, faint and dashed behind this cell's.
   *
   * A merge is the thing this makes visible: two traces running until they
   * stop, and a third carrying on from where their values were. The panel can
   * say "merged" in a tag and the family chart can say which cells, but only
   * this says what the merge did to the storm -- whether the survivor took the
   * strongest of them or came out above all three.
   *
   * Dashed and unlabelled, because they are context: the reader asked about
   * one cell and the others are here to give its line something to be measured
   * against. They are folded into the scale rather than clipped, or a relative
   * stronger than the open cell would leave the chart through the top.
   */
  const relativeSeries = relatives.map((other) => (other.series ?? []).map((step) => ({
    t: new Date(step.t).getTime(),
    v: panel.pick(step),
  })));
  const scale = verticalScale(
    [
      ...panel.values,
      ...relativeSeries.flatMap((points) => points.map((point) => point.v)),
    ].filter((v): v is number => v !== null),
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
    family: scale
      ? relativeSeries.map((points) => path(points, atX, scale)).filter(Boolean)
      : [],
    path: path(points, atX, scale),
    last: lastAt >= 0 ? { t: times[lastAt], v: panel.values[lastAt] as number } : null,
  };
  // `flatMap` rather than `filter`, so a panel whose series is missing drops
  // out with its `scale` narrowed to non-null for everything downstream.
}).flatMap((panel) => (panel.scale ? [{ ...panel, scale: panel.scale }] : []));

/**
 * Whole minutes at a step that fits, from lib/timeTicks.ts.
 *
 * The old axis labelled three moments taken from the data -- first reading,
 * last reading, end of the forecast -- which moved with the cell and left a
 * track running 16:07 to 16:52 with nothing between its two ends. Ticks on the
 * clock read the same way as every other time in this panel, and two charts
 * stacked over one window line up with each other.
 */
$: ticks = span ? timeTicks(span.from, span.to, 4) : [];

/**
 * The ticks with their positions already worked out.
 *
 * Not `x={atX(t)}` in the markup, which is what this was. The block is keyed
 * on the tick's timestamp so that a tick surviving a change of cell is not
 * torn down and rebuilt -- and Svelte has no way to know `atX` reads `span`,
 * so a surviving tick kept the x it had been given under the old window.
 * Walking the family put 16:00 and 16:30 at the same pixel.
 *
 * Computed in a reactive statement that names `span` outright, so it is redone
 * whenever the window moves and every tick in it is a new object.
 */
$: tickMarks = span
  ? ticks.map((t) => ({ t, x: atX(t), label: clock(new Date(t).toISOString()) }))
  : [];

/**
 * Where the present is on the charts, and whether it is worth drawing.
 *
 * Not when it lands on the right-hand edge with the last reading, which is the
 * ordinary case for a cell being detected right now: a line on the axis says
 * nothing there, and the label would sit on top of the last tick.
 */
$: nowAt = span && tick > span.from ? atX(tick) : null;
/**
 * Which side of the line the label sits on.
 *
 * To the right where there is room, which reads better -- the label follows
 * the line the way a caption follows what it names. Where there is not, it
 * goes to the left rather than the axis being padded out to make room: a
 * tenth of the chart left empty to seat one eight-pixel word is a bad trade
 * on a chart this size.
 */
$: nowLabel = nowAt === null ? null : (plot.x1 - nowAt > 24
  ? { x: nowAt + 3, anchor: "start" }
  : { x: nowAt - 3, anchor: "end" });

/** The value gridlines, for the same reason: `panel.scale.at` is a function too. */
$: gridlines = panels.map((panel) => panel.scale.ticks.map((value) => ({
  value,
  y: panel.scale.at(value),
})));

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

/* ---- the family ---------------------------------------------------------- */

/**
 * The relatives of the open cell, fetched one at a time until the family closes.
 *
 * They cannot come from the map's own data. Tracks are fetched for the
 * viewport, and a storm's parent may have been detected well outside it -- or
 * before the window the map asked for -- so a family assembled from what is on
 * screen is arbitrarily truncated. `/cells/tracks/{code}` answers for any code,
 * which is what closes it.
 *
 * Breadth-first through `missingRelatives`, which names the codes the reached
 * tracks point at and we do not hold yet. It re-runs after each round, so a
 * grandparent is asked for only once its parent has arrived and confirmed it
 * exists, and nothing is asked for twice. `MAX_FAMILY` bounds it.
 */
let family: Map<string, CellTrackProperties> = new SvelteMap();
let loadingFamily = false;

async function loadFamily(root: CellTrackProperties) {
  /*
   * Kept when the new cell is one this family already holds.
   *
   * Walking the chart re-roots the panel on a relative, and rebuilding from
   * that relative meant starting again from a map of one: the chart fell below
   * the two nodes it needs to draw anything, vanished, and grew back a round
   * at a time as the fetches landed. Every hop was a graph that disappeared and
   * relaid itself under a cursor that had not moved, which is the opposite of
   * what a thing you navigate by should do. Within one lineage the family is
   * the same family, so it survives the hop and only the highlight moves.
   */
  const known = family.has(root.code)
    ? family
    : new SvelteMap<string, CellTrackProperties>([[root.code, root]]);
  known.set(root.code, root);
  family = known;
  // Nothing to walk, and no request worth making for the two thirds of cells
  // that have no relatives at all.
  if (!missingRelatives(known, root.code).length) return;

  loadingFamily = true;
  try {
    for (let round = 0; round < 4; round += 1) {
      const wanted = missingRelatives(known, root.code)
        .slice(0, MAX_FAMILY - known.size);
      if (!wanted.length) break;
      const answers = await Promise.all(wanted.map((code) => fetchCellTrack(code).catch(() => null)));
      answers.forEach((answer) => {
        const relative = answer?.properties as CellTrackProperties | undefined;
        if (relative) known.set(relative.code, relative);
      });
      // A code that answers with nothing would be asked for every round; the
      // walk stops when a round adds nobody rather than spinning on it.
      if (!answers.some(Boolean)) break;
      // Reassigned as well as filled, so the chart re-renders on each round.
      family = new SvelteMap(known);
    }
  } finally {
    loadingFamily = false;
  }
}

/* Keyed on the code: the panel is reused when a relative is tapped in the
   chart, and the family has to be rebuilt around whichever cell is open. */
$: void loadFamily(track);

/* ---- how current any of this is ---------------------------------------- */

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
      {#each panels as panel, panelIndex (panel.key)}
        <figure>
          <figcaption>{panel.title}, {panel.unit}</figcaption>
          <svg viewBox="0 0 {CHART.width} {panel.height}" role="img"
               aria-label="{panel.title} over the tracked period, in {panel.unit}">
            {#each gridlines[panelIndex] ?? [] as line (line.value)}
              <line class="grid" x1={plot.x0} x2={plot.x1} y1={line.y} y2={line.y} />
              <text class="tick left" x={plot.x0 - 5} y={line.y}>{line.value}</text>
            {/each}

            <!-- The present, dashed, with the gap between it and the last
                 reading left visible to its right. Behind the traces: it is a
                 reference line rather than a measurement. -->
            {#if nowAt !== null}
              <line class="nowline" x1={nowAt} x2={nowAt} y1={CHART.top} y2={panel.y0} />
              <!-- Named once, on the upper panel: it has the headroom, and the
                   lower one's top gridline label sits where this would go. -->
              {#if panelIndex === 0 && nowLabel}
                <text class="nowlabel" x={nowLabel.x} y={CHART.top + 7}
                      text-anchor={nowLabel.anchor}>now</text>
              {/if}
            {/if}

            {#each tickMarks as mark, i (mark.t)}
              <line class="tickmark" x1={mark.x} x2={mark.x}
                    y1={panel.y0} y2={panel.y0 + (panel.axis ? 3 : 0)} />
              {#if panel.axis}
                <!-- Centred, except at the ends. A label centred on the first
                     tick hangs off the left of the plot and lands under the
                     value axis; the last one runs out past the direct label on
                     the right. Anchoring them inwards keeps both inside the
                     chart without moving the tick they belong to. -->
                <text class="tick" x={mark.x} y={panel.y0 + 13}
                      text-anchor={i === 0 ? "start"
                        : (i === tickMarks.length - 1 ? "end" : "middle")}>
                  {mark.label}
                </text>
              {/if}
            {/each}

            <line class="axis" x1={plot.x0} x2={plot.x0} y1={panel.y0} y2={CHART.top} />
            <line class="axis" x1={plot.x0} x2={plot.x1} y1={panel.y0} y2={panel.y0} />

            <!-- The family first, so this cell's line is never crossed by
                 one of theirs. -->
            {#each panel.family as d, i (i)}
              <path class="kin" {d} fill="none" />
            {/each}

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

  <CellLineage {track} known={family} loading={loadingFamily} />

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
      /* Pulled up and left into its own padding, but not out past the right
         edge: eight pixels of overhang there was enough to give the sheet a
         horizontal scrollbar, on a panel that has nothing to scroll sideways. */
      margin: -8px 0 -8px auto;
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
  /* The present. Dashed and light, because it is a reference the readings are
     placed against rather than one of them -- the same reason a gridline is
     lighter than a trace. */
  .nowline {
    stroke: currentColor;
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .nowlabel {
    font-size: 8px;
    fill: currentColor;
    fill-opacity: 0.55;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* The rest of the family: context rather than a reading, so no head, no
     label and no colour of its own. Dashed, because a faint solid line at this
     size is just a thin line and reads as another measurement. */
  .kin {
    stroke: currentColor;
    stroke-opacity: 0.3;
    stroke-width: 1;
    stroke-dasharray: 3 3;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  /**
   * A section heading, in the shape a phone draws one.
   *
   * The panel had no headings at all: a stack of figures whose captions are
   * axis labels -- "reflectivity, dBZ" -- doing double duty as titles, in the
   * same 11px grey as everything else. That reads as one long block rather
   * than as parts, which matters most on the sheet, where a reader scrolls
   * past the charts looking for the family and has nothing to aim at. A
   * heading is set in the panel's own text colour at a size above the body,
   * semibold, with the space above it that separates it from what came before.
   */
  :global(.cell-details .section) {
    margin: 16px 0 6px;
    font: 600 15px/1.2 var(--mc-font, system-ui);
    letter-spacing: -0.01em;
    color: var(--sl-color-neutral-900, #111);
  }
  :global(.cell-details .section .aside) {
    margin-left: 6px;
    font: 400 12px/1 var(--mc-font, system-ui);
    color: var(--sl-color-neutral-500, #78716c);
  }

  footer {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
