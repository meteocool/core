<script module lang="ts">
/**
 * How wide the slider grows at most, centred on the bottom edge: the guide in
 * the corner beside it (Guide3D) stands on that edge too where this leaves it
 * room.
 */
export const PEEL_MAX_WIDTH = 560;
</script>

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
 * card, and the credits. At its end, how the storms are drawn (StylePicker)
 * and which scan they are from (ScanPicker), so the edge stays one strip of
 * controls; the peel works in every style, and on an earlier scan's storms
 * as on the newest's.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { cloudStyle, peelLevel, peelManual, radarColormap } from "../stores";
import { dbzColour } from "../lib/cellVolume";
import { STYLE_FIELD } from "../lib/cloudStyle";
import { faCubes } from "@fortawesome/free-solid-svg-icons/faCubes";
import Icon from "./Icon.svelte";
import ScanPicker from "./ScanPicker.svelte";
import StylePicker from "./StylePicker.svelte";

/** Put an earlier scan's storms on the map, or the newest for null; without it, no picker. */
export let pickScan: ((scan: number | null) => void) | null = null;
/** Go into meteocool Studio (lib/studio); without it, where Studio is not offered, no way in. */
export let openStudio: (() => void) | null = null;

/** The reflectivity the track spans: the faintest the style draws to a typical core. */
const TRACK_MAX = 56;
$: trackMin = STYLE_FIELD[$cloudStyle].floor;

$: track = `linear-gradient(to right, ${
  Array.from({ length: 10 }, (_unused, i) => {
    const [r, g, b] = dbzColour(trackMin + ((TRACK_MAX - trackMin) * i) / 9, $radarColormap);
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

<div class="peel glass glass-tray" bind:offsetHeight={height}
  style:max-width={`${PEEL_MAX_WIDTH}px`}>
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
  <div class="pickers">
    <StylePicker />
    {#if pickScan}
      <ScanPicker pick={pickScan} />
    {/if}
    {#if openStudio}
      <button type="button" class="studio" on:click={openStudio} title={$_("studio.open_title")}>
        <Icon icon={faCubes} />
        <span>Studio</span>
      </button>
    {/if}
  </div>
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
    /* The pickers' pills at the end, as far in from it as from the top and bottom. */
    padding: 0 calc((var(--mc-control) - var(--mc-pill-h)) / 2) 0 16px;
    border-radius: var(--mc-radius-pill);
    color: var(--mc-text);
    font: 600 13px/1 var(--mc-font);
  }
  .pickers {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .label {
    flex: none;
  }
  /* The way into Studio, at the tray's end: a pill as the scan picker's is. */
  .studio {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-pill-h);
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .studio:hover { background: var(--mc-tint-hover); }
  .studio:active { transform: scale(var(--mc-press)); }
  .studio:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .studio :global(svg) { width: 12px; height: 12px; }

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
