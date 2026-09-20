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
  import { toolbarTransitionEnd } from "../lib/toolbarTransition";

  export let layerManager;

  // Driven by the capability registry rather than fixed markup, so a
  // capability withdrawn in src/caps/enabled.ts takes its tile with it and the
  // rest close the gap.
  $: tiles = [
    { layer: "radar", label: `🌧 ${$_("rain_and_thunderstorms")}` },
    { layer: "satellite", label: `🛰️ ${$_("nrt_satellite")}` },
    { layer: "precipTypes", label: `💧 ${$_("precipitation_types")}` },
    { layer: "aerosols", label: `💨 ${$_("aerosols")}` },
    { layer: "lightning", label: `⚡️ ${$_("lightning")}` },
  ].filter((tile) => capabilityEnabled(tile.layer));

  // Rain & thunderstorms is what this app is for, so it leads: a wide hero
  // across the top, the rest paired two across beneath it. An odd tile out in
  // that remainder spans its row rather than leaving a hole -- which is how
  // lightning sat when there were five of these.
  $: tailSpans = tiles.length > 1 && (tiles.length - 1) % 2 === 1;

  // The comparison panel is not a map layer, so it does not get a capability:
  // the tile opens it over the switcher instead of switching the map.
  let compareAt: { lat: number; lon: number } | null = null;

  function openCompare() {
    // The map centre as it stands when the panel opens, held until it is
    // reopened -- open-meteo's free tier is rate limited, and refetching on
    // every pan would spend that on views nobody is reading.
    const centre = layerManager.getCurrentMap()?.getView().getCenter();
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
    // The View is shared with the main map, which carries bottom padding for
    // the glass tray; the tiles are not under it.
    layerManager.maps[0]?.getView().setProperties({ padding: [0, 0, 0, 0] });
    layerManager.forEachMap((map, cap) => {
      const target = childCanvases[cap];
      console.log(`set ${cap} -> ${target}`);
      map.setTarget(target);
      map.updateSize();
    });
  };

  function open() {
    window.openLayerswitcher?.();
    // The iOS wrapper was told about close but never about open, so it could
    // not hide its own chrome while the switcher was up.
    if (dd.isIos()) {
      window.webkit?.messageHandlers.scriptHandler.postMessage(
        "layerSwitcherOpened",
      );
    }
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
    // Map.svelte re-measures the tray and restores the view padding.
    toolbarTransitionEnd();
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
  /* A 44px glass disc on the top line at right. Web only. */
  .lsToggle {
    position: absolute;
    top: var(--mc-top-stack);
    right: var(--mc-gutter);
    z-index: var(--mc-z-chrome);
    width: var(--mc-control-lg);
    height: var(--mc-control-lg);
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
    text-align: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .lsToggle:hover {
    background: var(--mc-glass-fill-strong);
    color: var(--mc-accent);
  }
  .lsToggle:active {
    transform: scale(var(--mc-press));
  }

  div :global(.lsIcon) {
    position: static;
    transform: none;
    font-size: 20px;
    stroke: none;
  }

  /* Full-screen sheet: solid material, no blur -- three live canvases sit on
     it and blurring the whole viewport is blurring the whole map. display is
     toggled inline by JS. */
  .ls {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: none;
    box-sizing: border-box;
    padding: calc(var(--mc-safe-top) + var(--mc-gutter)) var(--mc-gutter) calc(var(--mc-safe-bottom) + var(--mc-gutter));
    background: var(--mc-sheet);
    color: var(--mc-text);
    font-family: var(--mc-font);
    overflow-y: hidden;
    z-index: var(--mc-z-sheet);
  }

  .gridContainer {
    height: 100%;
    width: 100%;
    margin: 0;
    display: block;
    text-align: center;
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: var(--mc-gutter);
    height: 100%;
  }

  .maps {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1.4fr;         /* the hero row; the pairs below are 1fr */
    grid-auto-rows: 1fr;
    gap: var(--mc-gutter);
  }

  .cell {
    position: relative;
    min-height: 0;
    cursor: pointer;
    color: #fff;
    border-radius: var(--mc-radius-card);
    overflow: hidden;                    /* clips the canvas to the card; the label is absolute inside */
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease);
  }
  .cell::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--mc-separator), var(--mc-glass-highlight);
    pointer-events: none;
    z-index: 101;                        /* over the OL viewport and the .label (100) */
  }
  .cell:active {
    transform: scale(0.985);
  }
  .cell.wide {
    grid-column: span 2;
  }

  /* The hero is the primary layer, so its caption is scaled with the card
     rather than left at the secondary tiles' size. */
  .cell.hero :global(.label) {
    left: 14px;
    right: 14px;
    bottom: 14px;
    padding: 10px 16px;
    border-radius: 14px;
    font-size: 16px;
  }

  /* Not a MiniMap: there is no map behind it, so it is a card rather than glass. */
  .compare {
    flex: 0 0 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: var(--mc-sheet-card);
    border: 1px solid var(--mc-separator);
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-highlight);
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .compare:hover {
    background: var(--mc-sheet-card-hover);
  }
  .compare:active {
    transform: scale(0.985);
  }

  .compare-label {
    color: var(--mc-text);
    padding: 0 12px;
    font: 600 15px/1.2 var(--mc-font);
    text-align: center;
  }

  .compare-sub {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    font-weight: 500;
    color: var(--mc-text-2);
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
      <div class="maps">
        {#each tiles as tile, index (tile.layer)}
          <div
            class="cell"
            class:hero={index === 0}
            class:wide={index === 0 || (tailSpans && index === tiles.length - 1)}>
            <MiniMap
              {layerManager}
              layer={tile.layer}
              label={tile.label}
              on:mount={childMounted}
              on:changeLayer={changeLayer} />
          </div>
        {/each}
      </div>
      <div class="compare" on:click={openCompare}>
        <span class="compare-label">
          🌡 {$_("model_comparison")}
          <span class="compare-sub">{$_("model_comparison_sub")}</span>
        </span>
      </div>
    </div>
  </div>
</div>
