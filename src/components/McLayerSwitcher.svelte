<script>
  import Icon from "fa-svelte";
  import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
  import MiniMap from "./MiniMap.svelte";
  import { createEventDispatcher } from "svelte";
  import * as attributions from "../layers/attributions";

  export let layerManager;
  let childCanvases = {};

  const allAttributions = Object.entries(attributions)
    .filter((k) => k[0] !== "imprintAttribution")
    .map((k) => k[1])
    .join(" ");

  window.openLayerswitcher = () => {
    let ls = document.getElementById("ls");
    ls.style.display = "block";
    layerManager.forEachMap((map) => {
      const cap = map.get("capability");
      const target = childCanvases[map.get("capability")];
      console.log(`set ${cap} -> ${target}`);
      map.setTarget(target);
      map.updateSize();
    });
  };

  function open(elem) {
    elem.target.classList.remove("pulsate");
    window.openLayerswitcher();
  }

  function close() {
    document.getElementById("ls").style.display = "none";
    if ("webkit" in window) {
      window.webkit.messageHandlers["scriptHandler"].postMessage(
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
    height: 99%;
    width: 99.5%;
    text-align: center;
    display: block;
    margin: 0.1em auto;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 0.15em 0.1em;
    grid-template-areas: "reflectivity satellite" "weather help";
    height: 100%;
  }

  .reflectivity {
    grid-area: reflectivity;
  }
  .satellite {
    grid-area: satellite;
  }
  .weather {
    grid-area: weather;
  }
  .help {
    grid-area: help;
    position: relative;
  }

  .cell {
    height: 100%;
    cursor: pointer;
    color: white;
  }

  .helpText {
    font-family: Quattrocento;
    color: var(--sl-color-black);
    text-align: center;
    line-height: 2;
    cursor: default;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  @media only screen and (max-width: 600px) {
    .helpText {
      line-height: 1.5;
      font-size: 90%;
    }
  }

  .contributors{
    position: absolute;
    bottom: 0;
    font-size: 6pt;
    text-align: center;
    width: 100%;
  }
</style>

{#if window.device !== "ios" && window.device !== "android"}
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
          label={"⚡️ Rain & Thunderstorms"}
          on:mount={childMounted}
          on:changeLayer={changeLayer} />
      </div>
      <div class="satellite cell">
        <MiniMap
          {layerManager}
          layer={"satellite"}
          label={"🛰️ Real-Time Satellite"}
          on:mount={childMounted}
          on:changeLayer={changeLayer} />
      </div>
      <div class="weather cell">
        <MiniMap
          {layerManager}
          layer={"weather"}
          label={"🌤 Weather "}
          on:mount={childMounted}
          on:changeLayer={changeLayer} />
      </div>
      <div class="help cell">
        <div class="helpText">
          Today's weather is hardly worth mentioning? ☀️<br />Explore the
          near-realtime satellite map! 🌍
        </div>
        <div class="contributors">
          &copy; meteocool Contributors {allAttributions}
        </div>
      </div>
    </div>
  </div>
</div>
