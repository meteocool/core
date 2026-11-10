<script lang="ts">
/**
 * The way back from a detour to the 3D map, under the top line's middle.
 *
 * A tag on the flat map, or a panel's "open on the 3D map", is a detour to
 * look at one storm (lib/open3d.ts). Without this the way back is the layer
 * switcher, which offers the radar beside every other map and says nothing
 * about having come from it. Where the reader picked the 3D map themselves
 * there is nothing to go back to, and App leaves the button out.
 *
 * Under the top line rather than on it: that line's middle is the status
 * pill's, and the bottom is the storm's sheet and the peel slider's.
 */
import { fly } from "svelte/transition";
import { _ } from "svelte-i18n";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";
import Icon from "./Icon.svelte";

export let onback: () => void;
</script>

<div class="back-from-3d">
  <button type="button" class="glass glass-pill" on:click={onback} transition:fly={{ y: -12, duration: 200 }}>
    <Icon icon={faArrowLeft} />
    <span>{$_("guide_3d.back_to_map")}</span>
  </button>
</div>

<style>
  .back-from-3d {
    position: absolute;
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
    left: 0;
    width: 100%;
    z-index: var(--mc-z-pill);
    display: flex;
    justify-content: center;
    /* Only the button takes the pointer: a drag beside it moves the map. */
    pointer-events: none;
  }
  button {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px 0 12px;
    font: 600 13px/1 var(--mc-font);
    letter-spacing: -0.01em;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast), color var(--mc-motion-fast),
                transform var(--mc-motion-fast) var(--mc-ease);
  }
  button:hover { background: var(--mc-glass-fill-strong); color: var(--mc-accent); }
  button:active { transform: scale(var(--mc-press)); }
  button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .back-from-3d :global(svg) { width: 12px; height: 12px; color: var(--mc-accent); }
</style>
