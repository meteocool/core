<script lang="ts">
/**
 * Where a volume's radars stand around the storm, as a sketch: the storm in
 * the middle, each radar a dot, and the ground its lowest sweep reaches a
 * circle round it. Where the circles pile up the storm was seen from many
 * sides; a storm near the rim of the only circle was seen from one, far off
 * and high up.
 *
 * No basemap and no projection worth the name: kilometres east and north of
 * the storm, which is true enough over the few hundred a radar reaches.
 * North is up. The list below it names the radars, and `highlight` ties a
 * row to its dot.
 */
import type { Contribution } from "../lib/radarSites";

export let radars: Contribution[];
export let at: { lat: number; lon: number };
export let width = 300;
export let height = 150;
/** The code of the radar to pick out, the one the list is pointing at. */
export let highlight: string | null = null;

/** Room round the edge so a dot on the outermost radar is not cut in half. */
const PAD_PX = 10;
/** The least the map spans each way from the storm, so one radar next door does not fill it. */
const MIN_HALF_KM = 40;
const KM_PER_DEG_LAT = 110.57;

$: kmPerDegLon = 111.32 * Math.cos((at.lat * Math.PI) / 180);
$: placed = radars
  .filter((radar) => radar.site)
  .map((radar) => ({
    code: radar.code,
    name: radar.name,
    x: (radar.site!.lon - at.lon) * kmPerDegLon,
    y: (radar.site!.lat - at.lat) * KM_PER_DEG_LAT,
    rangeKm: radar.site!.rangeKm,
  }));
/* Fit the radars, not their circles: every circle covers the storm, so the
   overlap that matters is round the middle, and the rims can run off. */
$: halfX = Math.max(MIN_HALF_KM, ...placed.map((p) => Math.abs(p.x)));
$: halfY = Math.max(MIN_HALF_KM, ...placed.map((p) => Math.abs(p.y)));
$: scale = Math.max(0, Math.min((width / 2 - PAD_PX) / halfX, (height / 2 - PAD_PX) / halfY));
$: cx = width / 2;
$: cy = height / 2;
$: picked = placed.find((p) => p.code === highlight) ?? null;
</script>

{#if placed.length}
  <svg class="minimap" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
    <g class="sweeps">
      {#each placed as p (p.code)}
        <circle
          class:picked={p.code === highlight}
          cx={cx + p.x * scale}
          cy={cy - p.y * scale}
          r={p.rangeKm * scale}
        />
      {/each}
    </g>
    {#if picked}
      <line class="ray" x1={cx + picked.x * scale} y1={cy - picked.y * scale} x2={cx} y2={cy} />
    {/if}
    {#each placed as p (p.code)}
      <g class="radar" class:picked={p.code === highlight}>
        <circle class="dot" cx={cx + p.x * scale} cy={cy - p.y * scale} r="2.5" />
        <title>{p.name}</title>
      </g>
    {/each}
    <circle class="storm-ring" {cx} {cy} r="6" />
    <circle class="storm" {cx} {cy} r="3" />
  </svg>
{/if}

<style>
.minimap {
  display: block;
  margin: 0 0 12px;
  border-radius: var(--mc-radius-inner, 10px);
  background: var(--mc-tint);
  overflow: hidden;
}
/* Faint enough that the overlap reads as density: three circles over the
   storm are visibly darker there than one. */
.sweeps circle {
  fill: var(--mc-accent);
  fill-opacity: 0.05;
  stroke: var(--mc-accent);
  stroke-opacity: 0.35;
  stroke-width: 0.75;
  transition: fill-opacity var(--mc-motion-fast) var(--mc-ease), stroke-opacity var(--mc-motion-fast) var(--mc-ease);
}
.sweeps circle.picked { fill-opacity: 0.18; stroke-opacity: 0.9; stroke-width: 1.25; }
.ray { stroke: var(--mc-accent); stroke-width: 1; stroke-dasharray: 2 3; }
.radar .dot { fill: var(--mc-text-2); }
.radar.picked .dot { fill: var(--mc-accent); r: 3.5; }
.storm { fill: var(--mc-orange); }
.storm-ring { fill: none; stroke: var(--mc-orange); stroke-width: 1; stroke-opacity: 0.6; }
</style>
