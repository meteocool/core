<script lang="ts">
/**
 * What a storm's volume shows on the 3D map's panel, beside the cut the map
 * itself draws.
 *
 * Mostly a picture: the CAPPI sweeping through it, which shows the storm's
 * structure by height in a way the vertical cut on the map does not. Then
 * which radars it was built from, from how far, and how well their beams
 * covered it -- enough to judge it by, and no more reading.
 *
 * Shared by both kinds of storm, a tracked cell's and a core found only in
 * the composite, and headed in `StormPanel`'s sections.
 */
import { _ } from "svelte-i18n";
import CappiSweep from "./CappiSweep.svelte";
import { contributions } from "../lib/radarSites";
import type { CellVolume } from "../api";

export let volume: CellVolume;
/** Where the storm is, for how far each radar was from it; none when unknown. */
export let at: { lat: number; lon: number } | null = null;

let width = 300;

$: radars = at
  ? contributions(volume.sites ?? [], at.lat, at.lon)
  : (volume.sites ?? []).map((code) => ({ code, name: code.toUpperCase(), distanceKm: null }));
$: coverage = volume.coverage != null
  ? $_("storm.volume.coverage", { values: { pct: Math.round(volume.coverage * 100) } })
  : null;
</script>

<div class="provenance" bind:clientWidth={width}>
  <h3 class="section">CAPPI<span class="aside">{$_("storm.volume.cappi_aside")}</span></h3>
  <CappiSweep {volume} {width} height={Math.round(Math.min(240, width * 0.66))} />

  {#if radars.length}
    <h3 class="section">{$_("storm.volume.radars")}{#if coverage}<span class="aside">{coverage}</span>{/if}</h3>
    <ul class="radars">
      {#each radars as radar (radar.code)}
        <li>
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
.detail { color: var(--mc-text-2); font-variant-numeric: tabular-nums; }
</style>
