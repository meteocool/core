<script lang="ts">
/**
 * Whose tracking a storm is, as a small chip: "DWD" or "meteocool", with the
 * shape the flat map draws that storm's position in (layers/cells.ts), so the
 * chip and the mark it was tapped on say the same thing.
 *
 * In the storm panel's header and in the map key; the full name is the
 * title, for a pointer or a screen reader.
 */
import { _ } from "svelte-i18n";
import type { StormSource } from "../lib/stormSelection";

export let source: StormSource;
/** Quieter, for a second source behind the one the readings are from. */
export let secondary = false;
</script>

<span class="badge {source}" class:secondary title={$_(`storm.source.${source}_long`)}
  aria-label={$_(`storm.source.${source}_long`)} role="img">
  <svg viewBox="0 0 10 10" aria-hidden="true">
    {#if source === "dwd"}
      <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />
    {:else}
      <circle cx="5" cy="5" r="4" />
    {/if}
  </svg>
  <span>{$_(`storm.source.${source}`)}</span>
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 6px;
    border-radius: 5px;
    font: 700 11px/1 var(--mc-font);
    letter-spacing: 0.01em;
    white-space: nowrap;
    vertical-align: middle;
  }
  .badge svg {
    width: 8px;
    height: 8px;
    fill: currentColor;
  }
  /* DWD's own blue, so the chip reads as their product at a glance. */
  .dwd {
    background: #1d5ca8;
    color: #fff;
  }
  .meteocool {
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
  }
  .secondary {
    opacity: 0.55;
  }
</style>
