<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { _ } from "svelte-i18n";
  import { onMount } from "svelte";
  import Map from "ol/Map";
  import View from "ol/View";
  import type BaseLayer from "ol/layer/Base";
  import { dwdLayerStatic } from "../layers/dwd";
  import { capTimeIndicator } from "../stores";
  const dispatch = createEventDispatcher();
  export let layerManager;
  export let layer;
  export let label;
  /**
   * Whether this tile's map is a stand-in rather than the thing it advertises.
   *
   * The 3D cell view is a MapLibre map; every tile here is an OpenLayers one,
   * built by the same factory. So the tile for it shows the flat basemap and no
   * storms at all -- a black rectangle with a border on it -- and the reader has
   * no way to know that is the preview being approximate rather than the layer
   * being empty. Frosted and labelled, it stops making a claim it cannot keep:
   * the real map is built when the tile is tapped.
   */
  export let preview = false;

  let className = "";
  export { className as class };
  let uniqueID =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  onMount(async () => {
    dispatch("mount", {
      id: `map-${uniqueID}`,
      layer: layer,
    });
  });

  function mapInit(node) {
    if (preview) return decorativeMap(node);
    // A preview, not a handover: see LayerManager.setPreviewTarget. Mounting
    // these tiles used to move focus between capabilities as a side effect.
    layerManager.setPreviewTarget(layer, node.id);
    return undefined;
  }

  /**
   * A throwaway map for a tile whose capability cannot draw one.
   *
   * `setPreviewTarget` hands a capability's single map to a single element, so
   * two tiles cannot both show the radar -- and the 3D one has no OpenLayers
   * map of its own to hand over at all. Rather than leave it blank behind the
   * frosting, it gets its own map built here: the basemap the app is on, and
   * the newest radar frame over it.
   *
   * Decoration, and treated as such. No interactions, no controls, no
   * subscriptions, and nothing keeps it up to date -- it is behind a 10px blur
   * under a label saying Preview, and it exists so the tile reads as a map
   * rather than as a hole. If the radar has not loaded yet it simply shows the
   * basemap, which is what the other tiles do too.
   */
  function decorativeMap(node) {
    // Wherever the reader is looking, so the tile shows their weather rather
    // than a fixed corner of the country.
    const views: View[] = [];
    layerManager.forEachMap((map: Map) => views.push(map.getView()));
    const view: View | undefined = views[0];

    const preview_ = new Map({
      target: node,
      layers: [layerManager.baseLayerFactory(window.settings.get("mapBaseLayer"))],
      controls: [],
      interactions: [],
      view: new View({
        center: view?.getCenter() ?? [0, 0],
        zoom: (view?.getZoom() ?? 7) - 1,
      }),
    });

    /*
     * The radar goes on when there is radar, which is not now.
     *
     * These tiles mount with the app rather than when the switcher opens -- the
     * panel is built hidden -- so at this point the grid has not been fetched
     * and there is no frame to draw. Built once and left alone, the tile would
     * be a basemap for the rest of the session. Following the clock instead
     * puts the radar on as soon as it lands, and keeps it roughly current
     * after that for nothing: the check is a string compare.
     */
    let shown: string | null = null;
    let tiles: BaseLayer | null = null;
    const unsubscribe = capTimeIndicator.subscribe(() => {
      const radar = layerManager.getCapability("radar");
      const step = radar?.getMostRecentObservation?.();
      const frame = step === undefined ? null : radar?.clientGrid?.[step];
      if (!frame?.tile_id || frame.tile_id === shown) return;
      shown = frame.tile_id;
      if (tiles) preview_.removeLayer(tiles);
      [tiles] = dwdLayerStatic(frame.tile_id, frame.bucket);
      preview_.addLayer(tiles);
    });

    return {
      destroy() {
        unsubscribe();
        preview_.setTarget(undefined);
      },
    };
  }

  let _down = false;
  let lastX = 0;
  let lastY = 0;
  function mouseDown(evt) {
    _down = true;
    lastX = evt.clientX;
    lastY = evt.clientY;
  }

  function mouseUp(evt) {
    if (
      Math.abs(evt.clientX - lastX) < 10 &&
      Math.abs(evt.clientY - lastY) < 10
    ) {
      dispatch("changeLayer", layer);
    }
    _down = false;
  }
</script>

<style>
  :global(.miniMap) {
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;
    top: 0;
    left: 0;
  }
  :global(.miniMap > div:nth-child(1) > div:nth-child(3) > div:nth-child(3)) {
    display: none;
  }
  :global(.miniMap .ol-control) {
    display: none;
  }

  /* The frosting over a tile whose map is not the layer it stands for. Enough
     blur that the basemap reads as a texture rather than as content, which is
     the honest amount: there is nothing under it worth looking at. */
  .frost {
    position: absolute;
    inset: 0;
    z-index: 90;
    /* The tile clips to its card radius, but a backdrop-filter escapes an
       ancestor's *rounded* clip in both WebKit and Chromium -- only the square
       border box survives, so the frost poked out at the corners. It carries
       the radius itself; `inherit` keeps it tied to the card's. */
    border-radius: inherit;
    -webkit-backdrop-filter: blur(10px) saturate(1.2);
    backdrop-filter: blur(10px) saturate(1.2);
    background: var(--mc-glass-fill);
    pointer-events: none;
  }

  /* Where no blur is available the frosting would be a clear pane over a black
     map, so it becomes an opaque one instead. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .frost {
      background: var(--mc-glass-fill-solid);
    }
  }

  .previewTag {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 100;
    padding: 3px 8px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-label-fill);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font: 700 10px/1 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    pointer-events: none;
  }

  /* A dark caption capsule inset in the card. Deliberately no backdrop-filter:
     three of these sit over three live map canvases. */
  .label {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    top: auto;
    z-index: 100;
    display: block;
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--mc-radius-inner);      /* concentric with the 22px card at a 10px inset */
    background: var(--mc-label-fill);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 8px rgba(0, 0, 0, 0.25);
    color: #fff;
    font: 600 14px/1.2 var(--mc-font);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 1;
  }
</style>

<div
  id="map-{uniqueID}"
  class="miniMap"
  use:mapInit
  on:mousedown={mouseDown}
  on:mouseup={mouseUp} />
{#if preview}
  <div class="frost"></div>
  <div class="previewTag">{$_("preview")}</div>
{/if}
<div class="label" on:mousedown={mouseDown} on:mouseup={mouseUp}>{label}</div>
