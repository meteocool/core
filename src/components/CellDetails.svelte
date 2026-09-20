<script lang="ts">
/**
 * What one tracked thunderstorm has been doing.
 *
 * A cell's current reflectivity says very little on its own: a 55 dBZ core that
 * has been weakening for twenty minutes and one that has doubled its VIL in ten
 * are the same number and completely different storms. So this leads with the
 * signatures that separate a severe storm from a heavy shower -- rotation,
 * hail, a lightning jump, motion that departs from everything nearby -- and
 * shows the history behind the current reading.
 */
import { _ } from "svelte-i18n";
import { selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import type { CellTrackProperties } from "../api";

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

/**
 * A sparkline as an SVG path.
 *
 * A dozen points do not justify a chart library, and this one has to sit inside
 * a popup that appears and disappears with a tap.
 */
function sparkline(values: (number | null | undefined)[], width = 200, height = 32): string {
  const points = values.filter((v): v is number => v !== null && v !== undefined);
  if (points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

$: severity = Math.min(Math.max(track.max_severity, 0), 3);
$: colour = severityColour(severity);
$: series = track.series ?? [];
$: latest = series[series.length - 1];
$: forecast = track.forecast ?? [];
/** Minutes up to an hour, then hours: "127 min" is not a duration anyone reads. */
function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

$: age = duration((Date.now() - new Date(track.first_seen).getTime()) / 60_000);
$: trace = sparkline(series.map((step) => step.max_dbz));
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

  {#if trace && latest}
    <figure>
      <figcaption>reflectivity, {clock(series[0].t)}&ndash;{clock(latest.t)}</figcaption>
      <svg viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true">
        <path d={trace} fill="none" stroke={colour} stroke-width="1.5" />
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
    min-width: 230px;
    max-width: 280px;
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
  figure { margin: 0 0 4px; }
  figcaption {
    font-size: 10px;
    opacity: 0.55;
    margin-bottom: 2px;
  }
  svg {
    width: 100%;
    height: 32px;
    display: block;
  }
  footer {
    font-size: 11px;
    opacity: 0.6;
  }
</style>
