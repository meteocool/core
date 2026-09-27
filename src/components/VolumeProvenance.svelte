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
$: coverage = volume.coverage != null ? `${Math.round(volume.coverage * 100)}% beam coverage 3–8 km` : null;
</script>

<div class="provenance" bind:clientWidth={width}>
  <h3 class="section">CAPPI<span class="aside">slice at constant altitude</span></h3>
  <CappiSweep {volume} {width} height={Math.round(Math.min(240, width * 0.66))} />

  {#if radars.length}
    <h3 class="section">Radars{#if coverage}<span class="aside">{coverage}</span>{/if}</h3>
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
.radars { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.radars li { display: flex; justify-content: space-between; gap: 0.75rem; }
.detail { opacity: 0.65; font-variant-numeric: tabular-nums; }
</style>
