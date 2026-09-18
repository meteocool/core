<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { onMount } from "svelte";
  const dispatch = createEventDispatcher();
  export let layerManager;
  export let layer;
  export let label;

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
    layerManager.setTarget(layer, node.id);
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
<div class="label" on:mousedown={mouseDown} on:mouseup={mouseUp}>{label}</div>
