<script lang="ts">
  import McLayerSwitcher from "./McLayerSwitcher.svelte";
  import "ol/ol.css";
  import { layerswitcherVisible, bottomToolbarMode } from "../stores";
  import { tick } from "svelte";

  export let layerManager;
  let mapID;

  let visible;
  layerswitcherVisible.subscribe((value) => {
    visible = value;
  });

  function changeLayer(newLayer) {
    layerManager.setTarget(newLayer.detail, mapID);
  }

  function updateMapSize() {
    layerManager.forEachMap((map) => map.updateSize());
  }

  function mapInit(node: HTMLElement) {
    mapID = node.id;
    // Every MiniMap's action claims its capability's map as a preview, and an
    // OpenLayers Map has exactly one target -- so the default has to be applied
    // once they have all run, or the main map is left empty and whichever
    // MiniMap initialised last becomes the active capability. Svelte 3 ran
    // child actions first and this happened to hold; Svelte 5 runs the parent's
    // first, so wait for the mount flush rather than relying on the order.
    tick().then(() => layerManager.setDefaultTarget(mapID));
    bottomToolbarMode.subscribe((val) => {
      const mapElement = document.getElementById(mapID);
      if (!mapElement) return;
      if (val === "player") {
        mapElement.style.height = "calc(100% - 88px)";
      } else if (val === "collapsed") {
        mapElement.style.height = "calc(100% - calc(env(safe-area-inset-bottom) + 41px))";
      } else {
        mapElement.style.height = "100%";
      }
      layerManager.forEachMap((m) => {
        m.updateSize();
      });
    });
    setTimeout(updateMapSize, 300);
    return {
      destroy() {
        console.log("destroy");
      },
    };
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

<div id="map" use:mapInit />
{#if visible === "yes"}
  <McLayerSwitcher {layerManager} on:changeLayer={changeLayer} />
{/if}
