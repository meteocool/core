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
 * Until it is touched it stands where the style on the map starts it
 * (lib/peel.ts); touched, it is the reader's for the rest of the visit. The
 * track is the palette the clouds are painted in, and says what the thumb
 * means: from the faintest echo the style draws, at the left, to what a full
 * peel leaves of the strongest storm on the map, at the right. So over a
 * line of thunderstorms it runs from blue to red, and over a field of light
 * showers it is one colour from end to end, as there is nothing to peel.
 *
 * It takes the bottom edge the flat map's tray has, and publishes its height
 * as --mc-peel-h for what stands on that edge above it: the guide's pill and
 * card, and the credits. At its end, how the storms are drawn (StylePicker),
 * so the edge stays one strip of controls. Which scan the storms are from is
 * Studio's to choose (StudioTimeline); the map here is always the newest.
 */
import { onDestroy } from "svelte";
import { _ } from "svelte-i18n";
import { cloudStyle, peelLevel, peelManual, peelTop, radarColormap } from "../stores";
import { dbzColour } from "../lib/cellVolume";
import { STYLE_FIELD } from "../lib/cloudStyle";
import { faCubes } from "@fortawesome/free-solid-svg-icons/faCubes";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import Icon from "./Icon.svelte";
import StylePicker from "./StylePicker.svelte";
import { FEATURES } from "../features";

/** Go into meteocool Studio (lib/studio); without it, where Studio is not offered or not turned on, no way in. */
export let openStudio: (() => void) | null = null;
/** Go to the flight's plan (meteoair), Studio's tools or not; without it, no way to fly from here. */
export let openFlight: (() => void) | null = null;

/** The reflectivity the track spans: the faintest the style draws to what a full peel leaves of the strongest storm. */
$: trackMin = STYLE_FIELD[$cloudStyle].floor;
$: trackMax = Math.max($peelTop ?? trackMin, trackMin);

$: track = `linear-gradient(to right, ${
  Array.from({ length: 10 }, (_unused, i) => {
    const [r, g, b] = dbzColour(trackMin + ((trackMax - trackMin) * i) / 9, $radarColormap);
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
  <!-- None where the build offers neither the styles nor a way on (features.ts): no gap for an empty end. -->
  {#if FEATURES.stormStyles || openFlight || openStudio}
    <div class="pickers">
      {#if FEATURES.stormStyles}
        <StylePicker />
      {/if}
      {#if openFlight}
        <button type="button" class="studio" on:click={openFlight} title={$_("guide_3d.fly_title")}>
          <Icon icon={faPlaneDeparture} />
          <span>{$_("guide_3d.fly")}</span>
        </button>
      {/if}
      {#if openStudio}
        <button type="button" class="studio" on:click={openStudio} title={$_("studio.open_title")}>
          <Icon icon={faCubes} />
          <span>Studio</span>
        </button>
      {/if}
    </div>
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
  /* The ways into the flight and into Studio, at the tray's end: pills as the style picker's is. */
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
