<script lang="ts">
/**
 * Which parameter the weather stations over the radar map show, and when
 * what is on the map was measured: a glass pill of its own, floating a gap
 * above the player while the stations are on (NowcastPlayback).
 *
 * Out of the player and over it, where it is the most prominent control on
 * the map after the timeline: the parameter is what the stations are read
 * by. Over an open radar's pills (SiteSweepTray), if any. The stack over
 * the player makes room for it: while it is up, the root's
 * `stations-picker` adds to --mc-float-stack (src/glass.css), which the
 * strips, the storm hint, "Back to now" and the map's credits all stand on. Where the screen is too narrow for every parameter it scrolls
 * sideways, its edges fading out. The choice is remembered through
 * `stationChoice` (the setting `stationParameter`, App.svelte).
 */
import { onDestroy, onMount } from "svelte";
import { fly } from "svelte/transition";
import { _ } from "svelte-i18n";
import { format } from "date-fns";
import Segmented from "./Segmented.svelte";
import { STATION_CHOICES } from "../lib/stations";
import { fadeEdges } from "../lib/fadeEdges";
import { stationChoice, stationView } from "../stores";

$: options = STATION_CHOICES.map((value) => ({ value, label: $_(`stations.choice.${value}`) }));
$: time = $stationView?.observedAt ? format($stationView.observedAt, "HH:mm") : null;
$: status = $stationView
  ? (time ? $_("stations.observed", { values: { time } }) : $_("stations.none"))
  : "";

onMount(() => document.documentElement.classList.add("stations-picker"));
onDestroy(() => document.documentElement.classList.remove("stations-picker"));
</script>

<div class="stationPicker-dock">
  <div class="stationPicker glass glass-pill" transition:fly|global={{ y: 12, duration: 200 }}>
    <div class="scroller mc-fade-x" use:fadeEdges>
      <span class="row">
        <Segmented {options} bind:value={$stationChoice} label={$_("stations.choice.group")} compact />
        {#if $stationView}
          <span class="status" title={status} aria-live="polite">
            <span class="sr">{status}</span>
            <span aria-hidden="true">{time ?? "–"}</span>
          </span>
        {/if}
      </span>
    </div>
  </div>
</div>

<style>
  /* A row the width of the screen that lets touches through, so the pill
     can be centred, as "Back to now" is; directly over the player. */
  .stationPicker-dock {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(var(--mc-tray-bottom) + var(--mc-player-h) + var(--mc-tray-gap) + var(--mc-site-float-h));
    z-index: var(--mc-z-pill);
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .stationPicker {
    pointer-events: auto;
    box-sizing: border-box;
    max-width: 100%;
    height: var(--mc-float-pill-h);
    padding: 4px;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .scroller {
    min-width: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    border-radius: var(--mc-radius-pill);
  }
  .scroller::-webkit-scrollbar { display: none; }
  .row {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  /* Touch pans the row sideways from the picker too, rather than dragging
     its lens; a tap still chooses. */
  .row :global(.segmented.compact) {
    touch-action: pan-x;
  }
  .status {
    padding-right: 10px;
    color: var(--mc-accent);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
