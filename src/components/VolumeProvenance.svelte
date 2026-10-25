<script lang="ts">
/**
 * What a storm's volume shows on the 3D map's panel, beside the cut the map
 * itself draws.
 *
 * Mostly a picture: the CAPPI sweeping through it, which shows the storm's
 * structure by height in a way the vertical cut on the map does not. Then
 * which radars it was built from, from how far, and how well their beams
 * covered it: enough to judge it by, and no more. A sketch of where
 * they stand round the storm heads the list, a row picking out its radar.
 *
 * The flat map's panel takes the radars alone, under its own cutaway.
 *
 * Each radar carries its country's flag, and one whose sweeps are published
 * opens them in site mode (lib/openRadar.ts).
 *
 * Shared by both kinds of storm, a tracked cell's and a core found only in
 * the composite, and headed in `StormPanel`'s sections.
 */
import { _ } from "svelte-i18n";
import CappiSweep from "./CappiSweep.svelte";
import RadarMinimap from "./RadarMinimap.svelte";
import Flag from "./Flag.svelte";
import { contributions, countryOf, siteCode } from "../lib/radarSites";
import { openRadar, openRadarAvailable, radarsWithSweeps } from "../lib/openRadar";
import type { CellVolume } from "../api";

export let volume: CellVolume;
/** Where the storm is, for how far each radar was from it; none when unknown. */
export let at: { lat: number; lon: number } | null = null;
/** The CAPPI too, on the 3D map; the flat map's panel has its own cutaway and takes the radars alone. */
export let cappi = true;

let width = 300;
/** The radar a row is pointing at, picked out on the minimap. */
let highlight: string | null = null;

/* A mouse picks by hovering; a finger has no hover, so a tap toggles. What
   pressed is read on the way down: iOS Safari reports a tap's `click` as
   `pointerType: "mouse"`, so every tap was taken for the mouse and ignored. */
let pressedBy = "mouse";
function pick(code: string) {
  if (pressedBy === "mouse") return;
  highlight = highlight === code ? null : code;
}

$: radars = at
  ? contributions(volume.sites ?? [], at.lat, at.lon)
  : (volume.sites ?? []).map((code) => ({ code, name: code.toUpperCase(), distanceKm: null, lowestBeamKm: null, site: null }));
/* Which of them have sweeps to open: asked once per volume, the list keyed on it. */
let openable = new Set<string>();
let askedFor = "";
$: void listOpenable((volume.sites ?? []).join(","));
async function listOpenable(key: string) {
  if (key === askedFor || !$openRadarAvailable) return;
  askedFor = key;
  openable = new Set();
  const served = await radarsWithSweeps(volume.sites ?? []);
  if (askedFor === key) openable = served;
}
$: coverage = volume.coverage != null
  ? $_("storm.volume.coverage", { values: { pct: Math.round(volume.coverage * 100) } })
  : null;
/* Below the worker's floor the storm is drawn but never cut: the cutaway
   cannot show when its data is thin, so the panel says so instead. */
$: unopenable = volume.tier === 1;
</script>

<div class="provenance" bind:clientWidth={width}>
  {#if cappi}
    {#if unopenable}
      <p class="unopenable">{$_("storm.volume.not_openable")}</p>
    {/if}
    <h3 class="section">CAPPI<span class="aside">{$_("storm.volume.cappi_aside")}</span></h3>
    <CappiSweep {volume} {width} height={Math.round(Math.min(240, width * 0.66))} />
  {/if}

  {#if radars.length}
    <h3 class="section">{$_("storm.volume.radars")}{#if coverage}<span class="aside">{coverage}</span>{/if}</h3>
    {#if at}
      <RadarMinimap {radars} {at} {width} height={Math.round(Math.min(180, width * 0.5))} {highlight} />
    {/if}
    <ul class="radars">
      {#each radars as radar (radar.code)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
        <li
          class:picked={radar.code === highlight}
          on:pointerenter={(e) => { if (e.pointerType === "mouse") highlight = radar.code; }}
          on:pointerleave={(e) => { if (e.pointerType === "mouse") highlight = null; }}
          on:pointerdown={(e) => { pressedBy = e.pointerType; }}
          on:click={() => pick(radar.code)}
        >
          <span class="name">
            {#if openable.has(siteCode(radar.code))}
              <button type="button" class="open" title={$_("storm.volume.open_radar", { values: { radar: radar.name } })}
                on:click|stopPropagation={() => openRadar(radar.code)}>{radar.name}<span class="chevron" aria-hidden="true">›</span></button>
            {:else}
              {radar.name}
            {/if}
          </span>
          <span class="detail">
            {#if radar.distanceKm != null}{Math.round(radar.distanceKm)} km{/if}
            <Flag country={countryOf(radar.code)} />
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
/* The rows StormPanel's `.facts` are: a hairline between them, the detail in
   the secondary ink at the far end. */
.radars { list-style: none; margin: 0; padding: 0; }
.radars li { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; padding: 10px 0; }
.radars li + li { border-top: 0.5px solid var(--mc-separator); }
.radars li:first-child { padding-top: 0; }
.radars li.picked .name { color: var(--mc-accent); }
.name { min-width: 0; }
.detail { display: inline-flex; align-items: center; gap: 8px; }
/* A radar with sweeps opens them: a link in the row, the row's hover kept. */
.open {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.open:hover { text-decoration: underline; }
.open:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; border-radius: 3px; }
.chevron { margin-left: 4px; color: var(--mc-accent); font-weight: 600; }
.detail { color: var(--mc-text-2); font-variant-numeric: tabular-nums; }
.unopenable { margin: 0 0 12px; color: var(--mc-text-2); font-size: 13px; line-height: 1.4; }
</style>
