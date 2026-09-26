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
 * Laid out as a cell's details are, in the same `StormPanel`, and in the same
 * order where the two have the same things to say: the dial that turns the
 * cut on the map, the readings, then the volume by height and the radars it
 * came from -- see `VolumeProvenance`. No cutaway of its own: these open on the
 * 3D map, where the storm already stands cut open behind the panel, and a
 * second raymarched copy of it cost the GPU a frame for nothing.
 */
import { get } from "svelte/store";
import { onDestroy } from "svelte";
import { locale } from "svelte-i18n";
import SliceDial from "./SliceDial.svelte";
import StormPanel from "./StormPanel.svelte";
import Readings from "./Readings.svelte";
import VolumeProvenance from "./VolumeProvenance.svelte";
import { dbzColour } from "../lib/cellVolume";
import { duration, reading } from "../lib/cellMetrics";
import { stormPlace, type StormPlace } from "../lib/reverseGeocode";
import { radarColormap, selectedVolume, sharedActiveCap } from "../stores";
import type { RadarVolume } from "../api";

export let cloud: RadarVolume;
/**
 * In the phone's sheet, which rests as tall as what it holds: the header, the
 * dial and the readings, with the volume by height behind a pull. On a phone
 * every row of the resting sheet is map the storm behind it does not get.
 */
export let compact = false;
/** In the sheet: whether it has been pulled up, which is when the volume shows. */
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

/** The same quarter-minute clock `CellDetails` keeps, for "N min ago". */
let tick = Date.now();
const clockTimer = setInterval(() => { tick = Date.now(); }, 15_000);
onDestroy(() => clearInterval(clockTimer));

/** 24-hour, as every other time in the panels; see `CellDetails`. */
$: seen = new Date(cloud.reference_time)
  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
$: ago = duration(Math.max(0, (tick - new Date(cloud.reference_time).getTime()) / 60_000));

$: readings = [
  reading("peak", cloud.peak_dbz),
  // The threshold comes with the volume: the area is only meaningful beside it,
  // and it is set on the worker, where it has already changed once. No meter:
  // there is no class of storm by area to measure it against.
  ...(cloud.area_km2 != null
    ? [{
      key: "area",
      label: cloud.seed_dbz != null ? `area >${Math.round(cloud.seed_dbz)} dBZ` : "area",
      text: `${Math.round(cloud.area_km2)} km²`,
      band: null,
      bandName: null,
      fill: null,
    }]
    : []),
];

$: on3d = $sharedActiveCap === "cells3d";
$: showVolume = !compact || expanded;
</script>

<StormPanel {rule} label={place ? `3D radar view: ${place.name}` : UNNAMED} place={place?.area ?? null} onClose={close}>
  <span slot="header" class="headline">{title}</span>

  {#if on3d}
    <div class="dial"><SliceDial reference="north" /></div>
  {/if}

  <h3 class="section">Readings</h3>
  <Readings items={readings} />

  {#if showVolume}
    <!-- Keyed: a new storm is a new volume to fetch and describe. On the
         volume rather than the code, which is a grid position and comes round
         again when a core sits still into the next scan. -->
    {#key cloud.path}<VolumeProvenance volume={cloud} at={cloud} />{/key}
  {:else if expand}
    <button type="button" class="how" on:click={expand}>Slice by height, radars</button>
  {/if}

  {#if showVolume}
    <footer>observed {seen} &middot; {ago} ago</footer>
  {/if}
</StormPanel>

<style>
.dial { margin: 2px 0 8px; }
/* A quiet line, not a button that competes with the dial: it is there to say
   the sheet goes up, for the few who want what is above. */
.how {
  display: block;
  margin: 0 auto;
  font: inherit; font-size: 12px;
  background: none; border: none; color: inherit; opacity: 0.6; cursor: pointer;
  padding: 2px 12px 10px;
}
.how::before { content: "\2303"; margin-right: 0.35rem; }
.how:hover { opacity: 1; }
footer { padding-bottom: 4px; }
</style>
