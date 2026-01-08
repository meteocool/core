<script>
  import McLayerSwitcher from './McLayerSwitcher.svelte'
  import 'ol/ol.css'
  import { layerswitcherVisible, bottomToolbarMode } from '../stores'
  import { onDestroy } from 'svelte'
  import { logger } from '../lib/logger.js'

  let { layerManager } = $props()
  let mapID

  let visible = $state()
  const layerswitcherUnsub = layerswitcherVisible.subscribe((value) => {
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

    const bottomToolbarUnsub = bottomToolbarMode.subscribe((val) => {
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
        bottomToolbarUnsub?.()
        logger.log('destroy')
      },
    }
  }

  onDestroy(() => {
    layerswitcherUnsub?.()
  })
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
    /* Position zoom control top-right, below layer switcher */
    right: 0.5em;
    left: auto;
    top: var(--ol-controls-top, 0.5em);
  }

  /* Geolocate control positioning to stack below zoom */
  :global(.ol-geolocate) {
    right: 0.5em;
    left: auto;
    top: calc(var(--ol-controls-top, 0.5em) + 4.5em);
  }

  /* Keep OL default pointer event behavior; z-index fixes handle stacking */

  :global(:root) {
    --attributions-bottom-padding: 0.9em;
    /* Keep OL controls below the layer-switcher (top-right 74px + 6px borders + 12px gap) */
    --ol-controls-top: calc(1vh + 92px);
  }

  @media only screen and (max-width: 620px) {
    :global(:root) {
      --ol-controls-top: calc(1vh + 66px);
    }
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
