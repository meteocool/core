<script lang="ts">
/**
 * A storm opened for its volume alone.
 *
 * Most clouds with a volume are cores found in the radar composite that
 * KONRAD3D never reports -- it is a warning product, and a shower with a
 * respectable core is not something it warns about. So there is no track, no
 * forecast and no history for `CellDetails` to draw, and this is the whole of
 * what can honestly be said: where the core is, how strong it is, and what is
 * inside it.
 *
 * Titled by where it is, not by what it is. It used to say "Storm core", and
 * most of these are showers: the composite is searched for anything above
 * 30 dBZ, and calling every one a storm oversold all but a few. A place is
 * true of every one of them, and is what a reader tells two apart by.
 *
 * Why there is no path or forecast used to be a line under the facts, and
 * is gone: next to a 3D view on a map, a missing forecast cone is not what a
 * reader misses first. What is behind the pulled-up sheet is the volume by
 * height and the radars it came from -- see `VolumeProvenance`.
 */
import { get } from "svelte/store";
import { locale } from "svelte-i18n";
import CellCutaway from "./CellCutaway.svelte";
import SliceDial from "./SliceDial.svelte";
import CloseDisc from "./CloseDisc.svelte";
import VolumeProvenance from "./VolumeProvenance.svelte";
import { dbzColour } from "../lib/cellVolume";
import { stormPlace, type StormPlace } from "../lib/reverseGeocode";
import { radarColormap, selectedVolume } from "../stores";
import type { RadarVolume } from "../api";

export let cloud: RadarVolume;
/** Matches the charts' width in `CellDetails`, so the two popups line up. */
export let width = 340;
/**
 * The storm is already drawn cut on the map behind this, so the popup carries
 * only what the map cannot say, and the dial that turns the cut -- see
 * `SliceDial` for why that is all a phone needs. Laid out as a cell's details
 * are, because it sits in the same sheet: a header ruled in the storm's own
 * colour and the same glass close disc in the corner.
 */
export let compact = false;
/** In the sheet: whether it has been pulled up, which is when the provenance shows. */
export let expanded = false;
/** In the sheet: pull it up, for the button that says there is more. */
export let expand: (() => void) | null = null;

/** What the title says before the place arrives, and if it never does. */
const UNNAMED = "3D radar view";

let place: StormPlace | null = null;
let placeFor = "";

/** Name this storm, and drop the answer if another storm has been opened since. */
async function name(target: RadarVolume): Promise<void> {
  placeFor = target.path;
  place = null;
  const found = await stormPlace(target.lat, target.lon, get(locale) ?? "en");
  if (placeFor === target.path) place = found;
}
$: void name(cloud);
$: title = place?.name ?? UNNAMED;

$: rule = cloud.peak_dbz != null ? `rgb(${dbzColour(cloud.peak_dbz, $radarColormap).join(", ")})` : "currentColor";

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

<section class="cloud" class:compact aria-label={place ? `3D radar view: ${place.name}` : UNNAMED}>
  {#if compact}
    <header class="ruled" style="border-color: {rule}">
      <div class="title">
        <h2>{title}</h2>
        {#if place?.area}<p class="area">{place.area}</p>{/if}
      </div>
      <CloseDisc on:click={close} />
    </header>
    <p class="facts">{facts}</p>
    <div class="dial"><SliceDial reference="north" /></div>
    {#if expanded}
      <!-- Keyed like the cutaway: a new storm is a new volume to describe. -->
      {#key cloud.path}<div class="more"><VolumeProvenance {cloud} /></div>{/key}
    {:else if expand}
      <button type="button" class="how" on:click={expand}>Slice by height, radars</button>
    {/if}
  {:else}
    <header>
      <div class="title">
        <h2>{title}</h2>
        {#if place?.area}<p class="area">{place.area}</p>{/if}
      </div>
      <button type="button" class="close" aria-label="Close" on:click={close}>&times;</button>
    </header>
    <p class="facts">{facts}</p>
    <h3 class="section">Inside<span class="aside">drag to turn the cut</span></h3>
    <!-- Keyed, so each storm gets a fresh cutaway: its own slice, its own fetch.
         On the volume rather than the code, which is a grid position and comes
         round again when a core sits still into the next scan. -->
    {#key cloud.path}
      <CellCutaway volume={cloud} headingDeg={null} {width} height={210} />
      <details class="built" style="max-width: {width}px">
        <summary>Slice by height, radars</summary>
        <VolumeProvenance {cloud} />
      </details>
    {/key}
  {/if}
</section>

<style>
.cloud { display: flex; flex-direction: column; gap: 0.35rem; }
header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.title { min-width: 0; }
h2 { margin: 0; font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
.area { margin: 0.05rem 0 0; font-size: 0.75rem; opacity: 0.65; }
.close {
  font: inherit; font-size: 1.25rem; line-height: 1;
  background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer;
  padding: 0.1rem 0.35rem;
}
.close:hover { opacity: 1; }
/* The cell details' header: a rule in the storm's colour, the title beside it. */
.ruled { border-left: 4px solid; padding-left: 8px; margin-bottom: 2px; }
.compact .facts, .compact .more { padding-left: 12px; }
.compact .dial { margin-top: 6px; padding-bottom: 4px; }
.facts { margin: 0; font-size: 0.82rem; }
.more { padding-bottom: 12px; }
/* A quiet line, not a button that competes with the dial: it is there to say
   the sheet goes up, for the few who want what is above. */
.how {
  align-self: center;
  font: inherit; font-size: 0.75rem;
  background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer;
  padding: 0.35rem 0.75rem 0.5rem;
}
.how::before { content: "\2303"; margin-right: 0.35rem; }
.how:hover { opacity: 1; }
.built { margin-top: 0.35rem; font-size: 0.78rem; }
.built summary { cursor: pointer; opacity: 0.7; font-size: 0.75rem; }
.built summary:hover { opacity: 1; }
.built[open] summary { margin-bottom: 0.2rem; }

.section {
  margin: 0.5rem 0 0.1rem; font-size: 0.78rem; font-weight: 600;
  display: flex; justify-content: space-between; align-items: baseline;
}
.aside { font-weight: 400; opacity: 0.55; font-size: 0.7rem; }
</style>
