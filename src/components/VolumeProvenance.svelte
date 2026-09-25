<script lang="ts">
/**
 * What a storm's volume is, for the reader who pulls the sheet up.
 *
 * Mostly a picture: the CAPPI sweeping through it, which shows the storm's
 * structure by height in a way the vertical cut beside the map does not.
 * Then which radars it was built from and from how far, and one line of what
 * the volume itself carries -- enough to judge it by, and no more reading.
 */
import CappiSweep from "./CappiSweep.svelte";
import { contributions } from "../lib/radarSites";
import type { RadarVolume } from "../api";

export let cloud: RadarVolume;

let width = 300;

$: radars = contributions(cloud.sites ?? [], cloud.lat, cloud.lon);
$: seen = new Date(cloud.reference_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
$: coverage = cloud.coverage != null ? `${Math.round(cloud.coverage * 100)}% beam coverage 3–8 km` : null;
</script>

<div class="provenance" bind:clientWidth={width}>
  <h3 class="section">CAPPI<span class="aside">slice at constant altitude</span></h3>
  <CappiSweep volume={cloud} {width} height={Math.round(Math.min(280, width * 0.75))} />

  {#if radars.length}
    <h3 class="section">Radars</h3>
    <ul class="radars">
      {#each radars as radar (radar.code)}
        <li>
          <span>{radar.name}</span>
          {#if radar.distanceKm != null}<span class="detail">{Math.round(radar.distanceKm)} km</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="meta">{["DWD volume scan " + seen, coverage].filter(Boolean).join(" · ")}</p>
</div>

<style>
.provenance { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.78rem; line-height: 1.4; }
.section {
  margin: 0.4rem 0 0; font-size: 0.78rem; font-weight: 600;
  display: flex; justify-content: space-between; align-items: baseline;
}
.aside { font-weight: 400; opacity: 0.55; font-size: 0.7rem; }
.radars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.radars li { display: flex; justify-content: space-between; gap: 0.75rem; }
.detail { opacity: 0.65; font-variant-numeric: tabular-nums; }
.meta { margin: 0.1rem 0 0; opacity: 0.6; font-size: 0.72rem; }
</style>
