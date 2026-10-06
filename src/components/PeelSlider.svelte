<script lang="ts">
/**
 * The 3D map's peel, by hand: how far every storm is thinned towards its
 * core, as the iPhone's AR view offers it.
 *
 * Until it is touched it follows the clouds, which peel on their own
 * (layers/cellVolumeLayer.ts); touched, it holds them where it was left, and
 * they stay held for the rest of the visit rather than starting up again
 * under the reader's hand. The track is the palette the clouds are painted
 * in, weak to strong, which is what moving the thumb to the right leaves.
 *
 * It takes the bottom edge the flat map's tray has, and publishes its height
 * as --mc-peel-h for what stands on that edge above it: the guide's pill and
 * card, and the credits. At its end, which scan the storms are from
 * (ScanPicker), so the edge stays one strip of controls; the peel works on
 * an earlier scan's storms as on the newest's.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { peelLevel, peelManual, radarColormap } from "../stores";
import { dbzColour } from "../lib/cellVolume";
import ScanPicker from "./ScanPicker.svelte";

/** Put an earlier scan's storms on the map, or the newest for null; without it, no picker. */
export let pickScan: ((scan: number | null) => void) | null = null;

/** The reflectivity the track spans: the clouds' faintest to a typical core. */
const TRACK_MIN = 20;
const TRACK_MAX = 56;

$: track = `linear-gradient(to right, ${
  Array.from({ length: 10 }, (_unused, i) => {
    const [r, g, b] = dbzColour(TRACK_MIN + ((TRACK_MAX - TRACK_MIN) * i) / 9, $radarColormap);
    return `rgb(${r}, ${g}, ${b}) ${(i / 9) * 100}%`;
  }).join(", ")
})`;

function moved(event: Event) {
  peelManual.set(true);
  peelLevel.set(Number((event.currentTarget as HTMLInputElement).value));
}

let height = 0;
$: document.documentElement.style.setProperty("--mc-peel-h", `calc(${height}px + var(--mc-gutter))`);
onDestroy(() => document.documentElement.style.removeProperty("--mc-peel-h"));
</script>

<div class="peel glass glass-tray" class:picking={pickScan !== null} bind:offsetHeight={height}>
  <span class="label" aria-hidden="true">{$_("guide_3d.peel")}</span>
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    value={$peelLevel}
    aria-label={$_("guide_3d.peel_aria")}
    style:--track={track}
    on:input={moved} />
  {#if pickScan}
    <ScanPicker pick={pickScan} />
  {/if}
</div>

<style>
  .peel {
    position: absolute;
    left: calc(var(--mc-gutter) + env(safe-area-inset-left, 0px));
    right: calc(var(--mc-gutter) + env(safe-area-inset-right, 0px));
    bottom: calc(var(--mc-safe-bottom) + var(--mc-gutter));
    z-index: var(--mc-z-chrome);
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    height: var(--mc-control);
    margin: 0 auto;
    max-width: 560px;
    padding: 0 16px;
    border-radius: var(--mc-radius-pill);
    color: var(--mc-text);
    font: 600 13px/1 var(--mc-font);
  }
  /* The picker's pill at the end, as far in from it as from the top and bottom. */
  .peel.picking {
    padding-right: calc((var(--mc-control) - var(--mc-pill-h)) / 2);
  }
  .label {
    flex: none;
  }

  /* A native range, so keyboard, focus and touch come with it; only drawn. */
  input {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  input::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--mc-hairline);
  }
  input::-moz-range-track {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--mc-hairline);
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
  }
  input::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
  }
  input:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
</style>
