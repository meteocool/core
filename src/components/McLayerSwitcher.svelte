<script>
  import Icon from "fa-svelte";
  import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
  import MiniMap from "./MiniMap.svelte";
  import { createEventDispatcher } from "svelte";
  import * as attributions from "../layers/attributions";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import { _ } from "svelte-i18n";

  export let layerManager;
  const childCanvases = {};

  const allAttributionsArray = Object.entries(attributions)
    .filter((k) => k[0] !== "imprintAttribution")
    .map((k) => k[1]);
  allAttributionsArray.sort();
  const allAttributions = allAttributionsArray.join(" ");

  window.openLayerswitcher = () => {
    const ls = document.getElementById("ls");
    ls.style.display = "block";
    layerManager.forEachMap((map, cap) => {
      const target = childCanvases[cap];
      console.log(`set ${cap} -> ${target}`);
      map.setTarget(target);
      map.updateSize();
    });
  };

  function open(elem) {
    window.openLayerswitcher();
  }

  function close() {
    document.getElementById("ls").style.display = "none";
    layerManager.forEachMap((map, cap) => {
      console.log(`set ${cap} -> null`);
      map.setTarget(null);
      map.updateSize();
    });
    if (dd.isIos()) {
      window.webkit.messageHandlers.scriptHandler.postMessage(
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr 1fr;
    gap: 0.15em 0.15em;
    grid-template-areas: "reflectivity satellite" "precip-types aerosols" "lightning lightning";
    height: 100%;
  }

  .reflectivity {
    grid-area: reflectivity;
  }
  .satellite {
    grid-area: satellite;
  }
  .precip-types {
    grid-area: precip-types;
    position: relative;
  }
  .aerosols {
    grid-area: aerosols;
    position: relative;
  }

  .lightning {
    grid-area: lightning;
  }

  .cell {
    height: 100%;
    cursor: pointer;
    color: white;
  }
</style>

{#if !dd.isApp()}
  <div class="lsToggle" on:click={open}>
    <Icon icon={faLayerGroup} class="lsIcon" />
  </div>
{/if}

<div class="ls" id="ls">
  <div class="gridContainer">
    <div class="grid">
      <div class="reflectivity cell">
        <MiniMap
          {layerManager}
          layer={"radar"}
          label={`🌧 ${$_("rain_and_thunderstorms")}`}
          on:mount={childMounted}
          on:changeLayer={changeLayer} />
      </div>
      <div class="satellite cell">
        <MiniMap
          {layerManager}
          layer={"satellite"}
          label={`🛰️ ${$_("nrt_satellite")}`}
          on:mount={childMounted}
          on:changeLayer={changeLayer} />
      </div>
      <div class="precip-types cell">
          <MiniMap
                  {layerManager}
                  layer={"precipTypes"}
                  label={`💧 ${$_("precpitation_types")}`}
                  on:mount={childMounted}
                  on:changeLayer={changeLayer}
                  class="hidden" />
      </div>
      <div class="aerosols cell">
        <MiniMap
                {layerManager}
                layer={"aerosols"}
                label={`💨 ${$_("aerosols")}`}
                on:mount={childMounted}
                on:changeLayer={changeLayer} />
      </div>
      <div class="lightning cell">
        <MiniMap
                {layerManager}
                layer={"lightning"}
                label={`⚡️ ${$_("lightning")}`}
                on:mount={childMounted}
                on:changeLayer={changeLayer} />
      </div>
    </div>
  </div>
</div>
