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
 * Shared by both kinds of storm, a tracked cell's and a core found only in
 * the composite, and headed in `StormPanel`'s sections.
 */
import { _ } from "svelte-i18n";
import CappiSweep from "./CappiSweep.svelte";
import RadarMinimap from "./RadarMinimap.svelte";
import { contributions } from "../lib/radarSites";
import type { CellVolume } from "../api";

export let volume: CellVolume;
/** Where the storm is, for how far each radar was from it; none when unknown. */
export let at: { lat: number; lon: number } | null = null;

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
$: coverage = volume.coverage != null
  ? $_("storm.volume.coverage", { values: { pct: Math.round(volume.coverage * 100) } })
  : null;
/* Below the worker's floor the storm is drawn but never cut: the cutaway
   cannot show when its data is thin, so the panel says so instead. */
$: unopenable = volume.tier === 1;
</script>

<div class="provenance" bind:clientWidth={width}>
  {#if unopenable}
    <p class="unopenable">{$_("storm.volume.not_openable")}</p>
  {/if}
  <h3 class="section">CAPPI<span class="aside">{$_("storm.volume.cappi_aside")}</span></h3>
  <CappiSweep {volume} {width} height={Math.round(Math.min(240, width * 0.66))} />

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
          <span>{radar.name}</span>
          {#if radar.distanceKm != null}<span class="detail">{Math.round(radar.distanceKm)} km</span>{/if}
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
.radars li.picked span:first-child { color: var(--mc-accent); }
.detail { color: var(--mc-text-2); font-variant-numeric: tabular-nums; }
.unopenable { margin: 0 0 12px; color: var(--mc-text-2); font-size: 13px; line-height: 1.4; }
</style>
