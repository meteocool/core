<script lang="ts">
/**
 * A storm opened for its volume alone.
 *
 * Most clouds with a volume are storm cores found in the radar composite that
 * KONRAD3D never reports -- it is a warning product, and a shower with a
 * respectable core is not something it warns about. So there is no track, no
 * forecast and no history for `CellDetails` to draw, and this is the whole of
 * what can honestly be said: where the core is, how strong it is, and what is
 * inside it.
 *
 * Saying that there is no track is deliberate. A reader who has just opened a
 * KONRAD3D cell sees a history and a forecast cone; opening one of these and
 * finding neither, with no reason given, reads as the popup having broken.
 */
import CellCutaway from "./CellCutaway.svelte";
import { selectedVolume } from "../stores";
import type { RadarVolume } from "../api";

export let cloud: RadarVolume;
/** Matches the charts' width in `CellDetails`, so the two popups line up. */
export let width = 340;

const close = () => selectedVolume.set(null);

$: seen = new Date(cloud.reference_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
$: facts = [
  cloud.peak_dbz != null ? `peak ${Math.round(cloud.peak_dbz)} dBZ` : null,
  // The threshold comes with the volume: the area is only meaningful beside it,
  // and it is set on the worker, where it has already changed once.
  cloud.area_km2 != null
    ? `${Math.round(cloud.area_km2)} km²${cloud.seed_dbz != null ? ` above ${Math.round(cloud.seed_dbz)} dBZ` : ""}`
    : null,
  `at ${seen}`,
].filter(Boolean).join(" · ");
</script>

<section class="cloud" aria-label="Storm core">
  <header>
    <h2>Storm core</h2>
    <button type="button" class="close" aria-label="Close" on:click={close}>&times;</button>
  </header>
  <p class="facts">{facts}</p>
  <p class="why">
    Found in the radar composite rather than tracked by DWD, so there is no path
    or forecast for it &mdash; only what the radars saw inside it.
  </p>
  <h3 class="section">Inside<span class="aside">drag to turn the cut</span></h3>
  <!-- Keyed, so each storm gets a fresh cutaway: its own slice, its own fetch. -->
  {#key cloud.code}
    <CellCutaway volume={cloud} headingDeg={null} {width} height={210} />
  {/key}
</section>

<style>
.cloud { display: flex; flex-direction: column; gap: 0.35rem; }
header { display: flex; align-items: center; justify-content: space-between; }
h2 { margin: 0; font-size: 1rem; font-weight: 600; }
.close {
  font: inherit; font-size: 1.25rem; line-height: 1;
  background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer;
  padding: 0.1rem 0.35rem;
}
.close:hover { opacity: 1; }
.facts { margin: 0; font-size: 0.82rem; }
.why { margin: 0; font-size: 0.72rem; opacity: 0.6; line-height: 1.4; }
.section {
  margin: 0.5rem 0 0.1rem; font-size: 0.78rem; font-weight: 600;
  display: flex; justify-content: space-between; align-items: baseline;
}
.aside { font-weight: 400; opacity: 0.55; font-size: 0.7rem; }
</style>
