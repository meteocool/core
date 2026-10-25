<script lang="ts">
/**
 * Which parameter the weather stations over the radar map show, and when
 * what is on the map was measured: a row of the player while they are on.
 *
 * A row inside the player rather than glass of its own over the map, so it
 * can cover nothing: the player grows by exactly its height
 * (--mc-stations-tray-h in src/glass.css, switched by `stations-open` on the
 * root while this is mounted), as it does for site mode's tray, and the
 * timeline, the credits and the map's padding all move up with the tray.
 * The choice is remembered through `stationChoice` (the setting
 * `stationParameter`, App.svelte).
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { format } from "date-fns";
import Segmented from "./Segmented.svelte";
import { STATION_CHOICES } from "../lib/stations";
import { stationChoice, stationView } from "../stores";

$: options = STATION_CHOICES.map((value) => ({ value, label: $_(`stations.choice.${value}`) }));
$: time = $stationView?.observedAt ? format($stationView.observedAt, "HH:mm") : null;
$: status = $stationView
  ? (time ? $_("stations.observed", { values: { time } }) : $_("stations.none"))
  : "";

onMount(() => document.documentElement.classList.add("stations-open"));
onDestroy(() => document.documentElement.classList.remove("stations-open"));
</script>

<div class="stationPicker">
  <Segmented {options} bind:value={$stationChoice} label={$_("stations.choice.group")} compact />
  <!-- In full where there is room; a phone's row has the time alone beside
       the picker, or a dash for none, with the words still read out. -->
  <span class="status" title={status} aria-live="polite">
    <span class="long">{status}</span>
    <span class="short" aria-hidden="true">{$stationView ? (time ?? "–") : ""}</span>
  </span>
</div>

<style>
  .stationPicker {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--mc-site-row-h);
    min-width: 0;
    padding: 0 0 0 4px;
  }
  .status {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    font: 500 12px/1.2 var(--mc-font);
    color: var(--mc-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .short { display: none; }
  @media only screen and (max-width: 620px) {
    .status { text-align: right; }
    .long {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .short { display: inline; }
  }
</style>
