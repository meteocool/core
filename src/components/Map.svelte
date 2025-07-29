<script>
  import McLayerSwitcher from './McLayerSwitcher.svelte'
  import 'ol/ol.css'
  import { layerswitcherVisible, bottomToolbarMode } from '../stores'
  import { tick } from 'svelte'
  import { logger } from '../lib/logger.js'

  let { layerManager } = $props()
  let mapID

  let visible = $state()
  layerswitcherVisible.subscribe((value) => {
    visible = value
  })

  function changeLayer(newLayer) {
    layerManager.setTarget(newLayer, mapID)
  }

  function updateMapSize() {
    layerManager.forEachMap((map) => map.updateSize())
  }

  function mapInit(node) {
    mapID = node.id
    layerManager.setDefaultTarget(mapID)

    // Ensure main map keeps radar capability after MiniMaps initialize
    setTimeout(() => {
      layerManager.setTarget('radar', mapID)
    }, 100)

    bottomToolbarMode.subscribe((val) => {
      if (val === 'player') {
        document.getElementById(mapID).style.height = 'calc(100% - 88px)'
      } else if (val === 'collapsed') {
        document.getElementById(mapID).style.height = 'calc(100% - calc(env(safe-area-inset-bottom) + 41px))'
      } else {
        document.getElementById(mapID).style.height = '100%'
      }
      layerManager.forEachMap((m) => {
        m.updateSize()
      })
    })
    setTimeout(updateMapSize, 300)
    return {
      destroy() {
        logger.log('destroy')
      },
    }
  }
</script>

<div id="map" use:mapInit></div>
{#if visible === 'yes'}
  <McLayerSwitcher {layerManager} onchangeLayer={changeLayer} />
{/if}

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
