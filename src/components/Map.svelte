<script>
  import McLayerSwitcher from './McLayerSwitcher.svelte'
  import 'ol/ol.css'
  import { layerswitcherVisible, bottomToolbarMode } from '../stores'
  import { onDestroy } from 'svelte'
  import { DeviceDetect as dd } from '../lib/DeviceDetect'
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

    let updateTimeout
    const updateMapHeightForApp = () => {
      const mapElement = document.getElementById(mapID)
      if (!mapElement) return
      const toolbars = Array.from(document.querySelectorAll('.bottomToolbar'))
      let minTop = null
      toolbars.forEach((element) => {
        const style = window.getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return
        const rect = element.getBoundingClientRect()
        if (rect.height <= 0) return
        if (minTop === null || rect.top < minTop) {
          minTop = rect.top
        }
      })
      if (minTop === null) {
        mapElement.style.height = '100%'
      } else {
        mapElement.style.height = `${Math.max(0, Math.round(minTop))}px`
      }
      layerManager.forEachMap((m) => m.updateSize())
    }

    const scheduleMapHeightUpdate = () => {
      if (updateTimeout) {
        window.clearTimeout(updateTimeout)
      }
      updateMapHeightForApp()
      updateTimeout = window.setTimeout(() => {
        updateMapHeightForApp()
      }, 450)
    }

    const bottomToolbarUnsub = bottomToolbarMode.subscribe((val) => {
      const mapElement = document.getElementById(mapID)
      if (!mapElement) return
      if (dd.isApp()) {
        scheduleMapHeightUpdate()
        return
      }
      if (val === 'player') {
        mapElement.style.height = 'calc(100% - 88px)'
      } else if (val === 'collapsed') {
        mapElement.style.height = 'calc(100% - calc(env(safe-area-inset-bottom) + 41px))'
      } else {
        mapElement.style.height = '100%'
      }
      layerManager.forEachMap((m) => {
        m.updateSize()
      })
    })
    const handleResize = () => {
      if (dd.isApp()) {
        scheduleMapHeightUpdate()
      }
    }
    window.addEventListener('resize', handleResize)
    setTimeout(updateMapSize, 300)
    return {
      destroy() {
        bottomToolbarUnsub?.()
        window.removeEventListener('resize', handleResize)
        if (updateTimeout) {
          window.clearTimeout(updateTimeout)
          updateTimeout = null
        }
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
