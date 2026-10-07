<script lang="ts">
/**
 * Where a volume's radars stand around the storm, as a sketch: the storm in
 * the middle, each radar a dot, and the ground its lowest sweep reaches a
 * circle round it. Where the circles pile up the storm was seen from many
 * sides; a storm near the rim of the only circle was seen from one, far off
 * and high up.
 *
 * Under it only the water, the coast and the borders, out of the basemap's
 * own tiles (`lib/minimapBasemap.ts`), and no projection worth the name:
 * kilometres east and north of the storm, which is true enough over the few
 * hundred a radar reaches. North is up. The list below it names the radars,
 * and `highlight` ties a row to its dot.
 */
import { onDestroy } from "svelte";
import type { Contribution } from "../lib/radarSites";
import { outlinesWithin, type Line, type Outlines } from "../lib/minimapBasemap";

export let radars: Contribution[];
export let at: { lat: number; lon: number };
export let width = 300;
export let height = 150;
/** The code of the radar to pick out, the one the list is pointing at. */
export let highlight: string | null = null;

/** Room round the edge so a dot on the outermost radar is not cut in half. */
const PAD_PX = 10;
/** The least the map spans each way from the storm, so one radar next door does not fill it. */
const MIN_HALF_KM = 80;
/** How much further out than the farthest radar the map reaches, for some ground round the dots. */
const ZOOM_OUT = 1.4;
/** Points closer than this on screen are one: the tiles carry more coast than a sketch can show. */
const THIN_PX = 1.5;
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
$: halfX = ZOOM_OUT * Math.max(MIN_HALF_KM, ...placed.map((p) => Math.abs(p.x)));
$: halfY = ZOOM_OUT * Math.max(MIN_HALF_KM, ...placed.map((p) => Math.abs(p.y)));
$: scale = Math.max(0, Math.min((width / 2 - PAD_PX) / halfX, (height / 2 - PAD_PX) / halfY));
$: cx = width / 2;
$: cy = height / 2;
$: picked = placed.find((p) => p.code === highlight) ?? null;

/* The ground the map shows, in degrees, rounded out to a tenth so a resize
   or a storm moving a kilometre does not ask for the tiles again. */
$: spanLon = scale > 0 ? width / 2 / scale / kmPerDegLon : 0;
$: spanLat = scale > 0 ? height / 2 / scale / KM_PER_DEG_LAT : 0;
$: box = [
  Math.floor((at.lon - spanLon) * 10) / 10,
  Math.floor((at.lat - spanLat) * 10) / 10,
  Math.ceil((at.lon + spanLon) * 10) / 10,
  Math.ceil((at.lat + spanLat) * 10) / 10,
].join(",");

let outlines: Outlines | null = null;
let destroyed = false;
let asked = "";
$: if (placed.length && scale > 0 && box !== asked) load(box);

function load(key: string) {
  asked = key;
  const [west, south, east, north] = key.split(",").map(Number);
  outlinesWithin(west, south, east, north).then(
    (found) => { if (!destroyed && asked === key) outlines = found; },
    // No ground is still a readable sketch; the circles do not need it.
    () => {},
  );
}
onDestroy(() => (destroyed = true));

/** Lines as one SVG path, thinned to what shows at this scale. */
function path(lines: Line[], closed: boolean, lon0: number, lat0: number, k: number, kLon: number): string {
  let d = "";
  for (const line of lines) {
    let lastX = NaN;
    let lastY = NaN;
    let points = 0;
    for (let i = 0; i < line.length; i += 2) {
      const x = cx + (line[i] - lon0) * kLon * k;
      const y = cy - (line[i + 1] - lat0) * KM_PER_DEG_LAT * k;
      const last = i === line.length - 2;
      if (points && !last && Math.abs(x - lastX) < THIN_PX && Math.abs(y - lastY) < THIN_PX) continue;
      d += `${points ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      lastX = x;
      lastY = y;
      points++;
    }
    if (closed && points) d += "Z";
  }
  return d;
}

$: ground = outlines
  ? {
    water: path(outlines.water, true, at.lon, at.lat, scale, kmPerDegLon),
    coast: path(outlines.coast, false, at.lon, at.lat, scale, kmPerDegLon),
    country: path(outlines.country, false, at.lon, at.lat, scale, kmPerDegLon),
    region: path(outlines.region, false, at.lon, at.lat, scale, kmPerDegLon),
  }
  : null;
</script>

{#if placed.length}
  <svg class="minimap" {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
    {#if ground}
      <g class="ground">
        <path class="water" d={ground.water} />
        <path class="region" d={ground.region} />
        <path class="coast" d={ground.coast} />
        <path class="country" d={ground.country} />
      </g>
    {/if}
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
/* The ground stays under everything else, in the inks of the text: a coast
   and a border to place the storm by, never louder than the circles. */
.ground path { fill: none; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.ground .water { fill: rgba(0, 0, 0, 0.07); stroke: none; }
:global(html[data-theme="dark"]) .ground .water { fill: rgba(0, 0, 0, 0.3); }
.ground .coast { stroke: var(--mc-text-3); stroke-width: 0.75; }
.ground .country { stroke: var(--mc-text-2); stroke-width: 0.9; stroke-dasharray: 3 2; }
.ground .region { stroke: var(--mc-text-3); stroke-width: 0.5; stroke-opacity: 0.6; }
.storm { fill: var(--mc-orange); }
.storm-ring { fill: none; stroke: var(--mc-orange); stroke-width: 1; stroke-opacity: 0.6; }
</style>
