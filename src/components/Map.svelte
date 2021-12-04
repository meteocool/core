<script>
  import McLayerSwitcher from "./McLayerSwitcher.svelte";
  import "ol/ol.css";
  import { layerswitcherVisible, bottomToolbarMode } from "../stores";
  import { tick } from 'svelte';

  export let layerManager;
  let mapID;

  let visible;
  layerswitcherVisible.subscribe((value) => {
    visible = value;
  });

  function changeLayer(newLayer) {
    layerManager.setTarget(newLayer.detail, mapID);
  }

  async function updateMapSize() {
    await tick();
    layerManager.getCurrentMap().updateSize();
  }

    function mapInit(node) {
    mapID = node.id;
    return {
      destroy() {
        console.log("destroy");
      },
    };
  }

  function mainMapInit(node) {
    mapInit(node);
    layerManager.setDefaultTarget(node.id);
    updateMapSize();
    bottomToolbarMode.subscribe((val) => {
      if (val === "player") {
        document.getElementById(node.id).style.height =
                "calc(100% - 88px)";
      } else if (val === "collapsed") {
        document.getElementById(node.id).style.height =
                "calc(100% - calc(env(safe-area-inset-bottom) + 41px))";
      } else {
        document.getElementById(node.id).style.height = "100%";
      }
      layerManager.forEachMap((m) => {
        m.updateSize();
      });
    });
  }
</script>

<style>
  #map {
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    z-index: 0;
  }

  :global(.ol-zoom) {
    display: none;
    /* XXX */
  }

  :global(:root) {
    --attributions-bottom-padding: 0.9em;
  }

  :global(.ol-attribution) {
    height: 1.2em;
    padding-bottom: calc(0.25em + var(--attributions-bottom-padding));
    font-size: 6pt;
  }
  :global(.ol-attribution ul) {
    font-size: 6pt;
  }
</style>

<div id="map" use:mainMapInit />
{#if visible === "yes"}
  <McLayerSwitcher {layerManager} on:changeLayer={changeLayer} />
{/if}
