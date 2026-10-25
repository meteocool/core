<script lang="ts">
/**
 * The weather stations over the radar map, on or off: a pill in the player
 * beside the storm key's, in its shape, pressed while they are drawn. The
 * choice is kept as the setting `layerStations` (App.svelte), as the storm
 * marks' is, and Settings switches it too.
 */
import { _ } from "svelte-i18n";
import { stationLayerVisible } from "../stores";
</script>

<button
  type="button"
  class="pill"
  aria-pressed={$stationLayerVisible}
  title={$_("stations.toggle")}
  on:click={() => stationLayerVisible.update((on) => !on)}>
  <!-- A wind barb, the overlay's own mark. -->
  <svg viewBox="0 0 18 10" aria-hidden="true">
    <path d="M2 8 15 8M15 8 12 2M11.5 8 9 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    <circle cx="2" cy="8" r="1.6" fill="currentColor" />
  </svg>
  <span>{$_("stations.pill")}</span>
</button>

<style>
  /* StormKey's pill, so the two read as one row of the same kind of thing. */
  .pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    box-sizing: border-box;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text-2);
    font: 600 11px/1 var(--mc-font);
    white-space: nowrap;
    cursor: pointer;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .pill:hover { background: var(--mc-tint-hover); }
  .pill:active { transform: scale(var(--mc-press)); }
  .pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .pill svg { width: 18px; height: 10px; }
  /* On: in the accent, as a switch that is on. */
  .pill[aria-pressed="true"] {
    background: color-mix(in srgb, var(--mc-accent) 18%, transparent);
    color: var(--mc-accent);
  }
</style>
