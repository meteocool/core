<script>
  import { onMount } from "svelte";
  let { layerManager, layer, label, onmount, onchangeLayer } = $props();
  let uniqueID =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  onMount(async () => {
    onmount?.({
      id: `map-${uniqueID}`,
      layer: layer,
    });
  });

  function mapInit(node) {
    layerManager.setTarget(layer, node.id);
  }

  let down = false;
  let lastX = 0;
  let lastY = 0;
  function mouseDown(evt) {
    down = true;
    lastX = evt.clientX;
    lastY = evt.clientY;
  }

  function mouseUp(evt) {
    if (
      Math.abs(evt.clientX - lastX) < 10 &&
      Math.abs(evt.clientY - lastY) < 10
    ) {
      onchangeLayer?.(layer);
    }
    down = false;
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

  .label {
    background: #212529;
    border-radius: 10px;
    position: relative;
    z-index: 100;
    display: block;
    top: -50%;
    padding: 4px 12px;
    opacity: 1;
    margin-left: 5%;
    margin-right: 5%;
  }
</style>

<div
  id="map-{uniqueID}"
  class="miniMap"
  use:mapInit
  onmousedown={mouseDown}
  onmouseup={mouseUp}
  role="button"
  tabindex="0"
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mouseDown(e); mouseUp(e); } }}>
</div>
<div class="label" onmousedown={mouseDown} onmouseup={mouseUp} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mouseDown(e); mouseUp(e); } }}>{label}</div>
