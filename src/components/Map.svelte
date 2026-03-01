<script>
  import McLayerSwitcher from './McLayerSwitcher.svelte'
  import 'ol/ol.css'
  import { layerswitcherVisible, bottomToolbarMode } from '../stores'
  import { onDestroy } from 'svelte'
  import { DeviceDetect as dd } from '../lib/DeviceDetect'
  import { logger } from '../lib/logger.js'

  const TOOLBAR_TRANSITION_EVENT = 'mc:toolbar-transition'
  const TOOLBAR_TRANSITION_POLL_FRAMES = 30

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
    let enforceRadarFrame = null
    enforceRadarFrame = window.requestAnimationFrame(() => {
      enforceRadarFrame = window.requestAnimationFrame(() => {
        enforceRadarFrame = null
        layerManager.setTarget('radar', mapID)
      })
    })

    let mapResizeFrame = null
    const scheduleMapResize = () => {
      if (mapResizeFrame !== null) return
      mapResizeFrame = window.requestAnimationFrame(() => {
        mapResizeFrame = null
        updateMapSize()
      })
    }

    let mapHeightFrame = null
    let toolbarTransitionPollFrame = null
    let toolbarTransitionFramesRemaining = 0
    const stopToolbarTransitionTracking = () => {
      toolbarTransitionFramesRemaining = 0
      if (toolbarTransitionPollFrame !== null) {
        window.cancelAnimationFrame(toolbarTransitionPollFrame)
        toolbarTransitionPollFrame = null
      }
    }
    const runToolbarTransitionTracking = () => {
      toolbarTransitionPollFrame = null
      scheduleMapHeightUpdate()
      if (toolbarTransitionFramesRemaining <= 0) return
      toolbarTransitionFramesRemaining -= 1
      toolbarTransitionPollFrame = window.requestAnimationFrame(runToolbarTransitionTracking)
    }
    const startToolbarTransitionTracking = () => {
      toolbarTransitionFramesRemaining = TOOLBAR_TRANSITION_POLL_FRAMES
      if (toolbarTransitionPollFrame === null) {
        toolbarTransitionPollFrame = window.requestAnimationFrame(runToolbarTransitionTracking)
      }
    }
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
        document.documentElement.style.setProperty('--bottom-toolbar-height', '0px')
      } else {
        const mapHeight = Math.max(0, Math.round(minTop))
        const toolbarHeight = Math.max(0, Math.round(window.innerHeight - minTop))
        mapElement.style.height = `${mapHeight}px`
        document.documentElement.style.setProperty('--bottom-toolbar-height', `${toolbarHeight}px`)
      }
      scheduleMapResize()
    }

    const scheduleMapHeightUpdate = () => {
      syncToolbarObservers()
      if (mapHeightFrame !== null) {
        window.cancelAnimationFrame(mapHeightFrame)
      }
      mapHeightFrame = window.requestAnimationFrame(() => {
        mapHeightFrame = null
        updateMapHeightForApp()
      })
    }

    let toolbarResizeObserver = null
    const observedToolbars = new Set()
    const syncToolbarObservers = () => {
      if (!toolbarResizeObserver) return
      const nextToolbars = new Set(document.querySelectorAll('.bottomToolbar'))
      observedToolbars.forEach((toolbar) => {
        if (!nextToolbars.has(toolbar)) {
          toolbarResizeObserver.unobserve(toolbar)
          observedToolbars.delete(toolbar)
        }
      })
      nextToolbars.forEach((toolbar) => {
        if (!observedToolbars.has(toolbar)) {
          toolbarResizeObserver.observe(toolbar)
          observedToolbars.add(toolbar)
        }
      })
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
      scheduleMapResize()
    })
    const handleResize = () => {
      if (dd.isApp()) {
        scheduleMapHeightUpdate()
        return
      }
      scheduleMapResize()
    }
    const handleToolbarTransition = (event) => {
      if (!dd.isApp()) return
      const phase = event?.detail?.phase
      if (phase === 'introstart' || phase === 'outrostart') {
        startToolbarTransitionTracking()
        return
      }
      if (phase === 'introend' || phase === 'outroend') {
        stopToolbarTransitionTracking()
      }
      scheduleMapHeightUpdate()
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener(TOOLBAR_TRANSITION_EVENT, handleToolbarTransition)
    if (dd.isApp()) {
      if (window.ResizeObserver) {
        toolbarResizeObserver = new window.ResizeObserver(() => scheduleMapHeightUpdate())
        syncToolbarObservers()
      }
      scheduleMapHeightUpdate()
    }
    scheduleMapResize()
    return {
      destroy() {
        bottomToolbarUnsub?.()
        window.removeEventListener('resize', handleResize)
        window.removeEventListener(TOOLBAR_TRANSITION_EVENT, handleToolbarTransition)
        stopToolbarTransitionTracking()
        if (mapHeightFrame !== null) {
          window.cancelAnimationFrame(mapHeightFrame)
          mapHeightFrame = null
        }
        if (mapResizeFrame !== null) {
          window.cancelAnimationFrame(mapResizeFrame)
          mapResizeFrame = null
        }
        if (enforceRadarFrame !== null) {
          window.cancelAnimationFrame(enforceRadarFrame)
          enforceRadarFrame = null
        }
        if (toolbarResizeObserver) {
          toolbarResizeObserver.disconnect()
          toolbarResizeObserver = null
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
{#if visible === 'yes' || dd.isApp()}
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

  :global(.is-app .ol-zoom),
  :global(.is-app .ol-geolocate) {
    display: none;
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
