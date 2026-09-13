<script lang="ts">
  import Icon from "./Icon.svelte";
  import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
  import MiniMap from "./MiniMap.svelte";
  import { createEventDispatcher } from "svelte";
  import * as attributions from "../layers/attributions";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import { _ } from "svelte-i18n";
  import ModelCompare from "./ModelCompare.svelte";
  import { toLonLat } from "ol/proj";
  import { capabilityEnabled } from "../caps/enabled";

  export let layerManager;

  // Driven by the capability registry rather than fixed markup, so a
  // capability withdrawn in src/caps/enabled.ts takes its tile with it and the
  // rest close the gap.
  $: tiles = [
    { layer: "radar", label: `🌧 ${$_("rain_and_thunderstorms")}` },
    { layer: "satellite", label: `🛰️ ${$_("nrt_satellite")}` },
    { layer: "precipTypes", label: `💧 ${$_("precpitation_types")}` },
    { layer: "aerosols", label: `💨 ${$_("aerosols")}` },
    { layer: "lightning", label: `⚡️ ${$_("lightning")}` },
  ].filter((tile) => capabilityEnabled(tile.layer));

  // The comparison panel is not a map layer, so it does not get a capability:
  // the tile opens it over the switcher instead of switching the map.
  let compareAt: { lat: number; lon: number } | null = null;

  function openCompare() {
    // The map centre as it stands when the panel opens, held until it is
    // reopened -- open-meteo's free tier is rate limited, and refetching on
    // every pan would spend that on views nobody is reading.
    const centre = layerManager.getCurrentMap().getView().getCenter();
    if (!centre) return;
    const [lon, lat] = toLonLat(centre);
    compareAt = { lat, lon };
  }
  const childCanvases = {};

  const allAttributionsArray = Object.entries(attributions)
    .filter((k) => k[0] !== "imprintAttribution")
    .map((k) => k[1]);
  allAttributionsArray.sort();
  // Built but never rendered; kept so the attribution list stays derived.
  const _allAttributions = allAttributionsArray.join(" ");

  window.openLayerswitcher = () => {
    const ls = document.getElementById("ls");
    if (!ls) return;
    ls.style.display = "block";
    layerManager.forEachMap((map, cap) => {
      const target = childCanvases[cap];
      console.log(`set ${cap} -> ${target}`);
      map.setTarget(target);
      map.updateSize();
    });
  };

  function open() {
    window.openLayerswitcher?.();
  }

  function close() {
    const ls = document.getElementById("ls");
    if (ls) ls.style.display = "none";
    layerManager.forEachMap((map, cap) => {
      console.log(`set ${cap} -> null`);
      map.setTarget(null);
      map.updateSize();
    });
    if (dd.isIos()) {
      window.webkit?.messageHandlers.scriptHandler.postMessage(
        "layerSwitcherClosed",
      );
    }
  }

  function childMounted(data) {
    childCanvases[data.detail.layer] = data.detail.id;
  }

  const dispatch = createEventDispatcher();

  function changeLayer(event) {
    close();
    dispatch("changeLayer", event.detail);
  }
</script>

<style>
  .lsToggle {
    width: 74px;
    height: 74px;
    background-color: var(--sl-color-white);
    border: 3px solid var(--sl-color-gray-700);
    border-radius: 40px;
    position: absolute;
    top: 1vh;
    right: 1vh;
    text-align: center;
    vertical-align: center;
    color: var(--sl-color-gray-700);
  }

  .lsToggle:hover {
    background-color: var(--sl-color-gray-700);
    color: var(--sl-color-white);
    border: 3px solid var(--sl-color-white);
    cursor: pointer;
  }

  div :global(.lsIcon) {
    font-size: 40px;
    position: absolute;
    top: 50%;
    left: 50%;
    -ms-transform: translate(-50%, -50%);
    transform: translate(-50%, -50%);
    stroke: white;
  }

  .ls {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0px;
    left: 0px;
    display: none;
    background-color: var(--sl-color-white);
    overflow-y: hidden;
    z-index: 10000000;
  }

  .gridContainer {
    height: 99.5%;
    width: 99.5%;
    text-align: center;
    display: block;
    margin: 0.1em auto 0;
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: 0.15em;
    height: 100%;
  }

  /* Not a MiniMap: there is no map behind it, so it carries its own label. */
  .compare {
    flex: 0 0 3.6em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #212529;
    border-radius: 10px;
  }

  .compare-label {
    color: #fff;
    padding: 4px 12px;
    font-size: 1em;
  }

  .compare-sub {
    display: block;
    font-size: 0.7em;
    opacity: 0.7;
  }

  .cell {
    flex: 1 1 0;
    min-height: 0;
    position: relative;
    cursor: pointer;
    color: white;
  }
</style>

{#if !dd.isApp()}
  <div class="lsToggle" on:click={open}>
    <Icon icon={faLayerGroup} class="lsIcon" />
  </div>
{/if}

{#if compareAt}
  <ModelCompare lat={compareAt.lat} lon={compareAt.lon} onClose={() => (compareAt = null)} />
{/if}

<div class="ls" id="ls">
  <div class="gridContainer">
    <div class="grid">
      {#each tiles as tile (tile.layer)}
        <div class="cell">
          <MiniMap
            {layerManager}
            layer={tile.layer}
            label={tile.label}
            on:mount={childMounted}
            on:changeLayer={changeLayer} />
        </div>
      {/each}
      <div class="compare" on:click={openCompare}>
        <span class="compare-label">
          🌡 {$_("model_comparison")}
          <span class="compare-sub">{$_("model_comparison_sub")}</span>
        </span>
      </div>
    </div>
  </div>
</div>
