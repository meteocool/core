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
 *
 * After the clock, how long ago that was, counting up while the pill is
 * up: on the timeline's past frames "03:20" alone leaves the reader to do the
 * sum. At the end, a way out that switches the stations off, as an open
 * radar's pill has (SiteSweepTray), outside the scroller so it never
 * scrolls out of reach.
 */
import { onDestroy, onMount } from "svelte";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { fly } from "svelte/transition";
import { _ } from "svelte-i18n";
import { format } from "date-fns";
import Segmented from "./Segmented.svelte";
import Icon from "./Icon.svelte";
import { STATION_CHOICES } from "../lib/stations";
import { fadeEdges } from "../lib/fadeEdges";
import { duration } from "../lib/cellMetrics";
import { onWake } from "../lib/wakeup";
import { stationChoice, stationLayerVisible, stationView } from "../stores";

$: options = STATION_CHOICES.map((value) => ({ value, label: $_(`stations.choice.${value}`) }));
$: time = $stationView?.observedAt ? format($stationView.observedAt, "HH:mm") : null;

/* The present the age counts from: on a timer, and at once on a wake. */
let now = Date.now();
const tick = window.setInterval(() => { now = Date.now(); }, 30_000);
const unsubscribeWake = onWake(() => { now = Date.now(); });
/* Never "in 1 min": a clock a little ahead of DWD's says "0 min ago". */
$: age = $stationView?.observedAt
  ? $_("storm.ago", { values: { duration: duration(Math.max(0, (now - $stationView.observedAt.getTime()) / 60_000), $_) } })
  : null;
$: status = $stationView
  ? (time ? `${$_("stations.observed", { values: { time } })}, ${age}` : $_("stations.none"))
  : "";

const hide = () => stationLayerVisible.set(false);

onMount(() => document.documentElement.classList.add("stations-picker"));
onDestroy(() => {
  document.documentElement.classList.remove("stations-picker");
  window.clearInterval(tick);
  unsubscribeWake();
});
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
            {#if time && age}<span class="age" aria-hidden="true">{age}</span>{/if}
          </span>
        {/if}
      </span>
    </div>
    <button type="button" class="close" on:click={hide}
      title={$_("stations.close")} aria-label={$_("stations.close")}>
      <Icon icon={faXmark} />
    </button>
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
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding-right: 4px;
    color: var(--mc-accent);
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* How long ago, quieter than the clock it qualifies. */
  .age {
    color: var(--mc-text-2);
    font-weight: 500;
  }
  /* The way out, as an open radar's pill has it (SiteSweepTray): a disc the
     segments' height, its glyph quiet until it is pointed at. */
  .close {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    margin-left: 6px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--mc-tint);
    color: var(--mc-text-3);
    font-size: 13px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .close:hover {
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .close:active {
    transform: scale(var(--mc-press));
    background: var(--mc-tint-active);
  }
  .close:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
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
