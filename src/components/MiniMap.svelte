<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { _ } from "svelte-i18n";
  import { onMount } from "svelte";
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
    // A preview, not a handover: see LayerManager.setPreviewTarget. Mounting
    // these tiles used to move focus between capabilities as a side effect.
    layerManager.setPreviewTarget(layer, node.id);
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
