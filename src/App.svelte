<script lang="ts">
  import View from 'ol/View'
  import { addMessages, init, getLocaleFromNavigator } from 'svelte-i18n'
  import { onDestroy } from 'svelte'

  import { io } from 'socket.io-client'
  import { fromLonLat } from 'ol/proj'
  import Map from './components/Map.svelte'
  import Logo from './components/Logo.svelte'
  import NowcastPlayback from './components/NowcastPlayback.svelte'
  import BottomToolbar from './components/BottomToolbar.svelte'
  import MapStatusOverlay from './components/MapStatusOverlay.svelte'

  import RadarCapability from './caps/RadarCapability'
  import SatelliteCapability from './caps/SatelliteCapability'

  import { LayerManager } from './lib/LayerManager'
  import NanobarWrapper from './lib/NanobarWrapper'
  import Settings from './lib/Settings'
  import { logger } from './lib/logger.js'

  import de from './locale/de.json'
  import en from './locale/en.json'
  import {
    bottomToolbarMode,
    colorSchemeDark,
    cycloneLayerVisible,
    lastFocus,
    layerswitcherVisible,
    lightningLayerVisible,
    logoStyle,
    mapBaseLayer,
    precacheForecast,
    radarColormap,
    radarColorScheme,
    snowLayerVisible,
    tileRefreshSignal,
    toolbarVisible,
  } from './stores'

  import './html/global.css'
  import './html/ui-tokens.css'
  import { apiBaseUrl, dataUrl, websocketBaseUrl } from './urls'
  import { initUIConstants, cleanupUIConstants } from './layers/ui'
  import makeLightningLayer from './layers/lightning'
  import StrikeManager from './lib/StrikeManager'
  import MesoCycloneManager from './lib/MesoCycloneManager'

  import makeMesocycloneLayer from './layers/mesocyclones'
  import { DeviceDetect as dd } from './lib/DeviceDetect'
  import { bordersAndWays, labelsOnly } from './layers/vector'
  import PrecipitationTypesCapability from './caps/PrecipitationTypesCapability'
  import { radolanOverlay } from './layers/dwd'
  import AerosolsCapability from './caps/AerosolsCapability'
  import LightningCapability from './caps/LightningCapability'

  interface Props {
    device: string
    postInitCb?: (_layerManager: LayerManager) => void
  }

  let { device, postInitCb }: Props = $props()

  $effect(() => {
    dd.set(device)
  })

  addMessages('de', de)
  addMessages('en', en)

  init({
    fallbackLocale: 'en',
    initialLocale: getLocaleFromNavigator(),
  })

  initUIConstants()

  if (dd.isApp()) {
    logoStyle.set('none')
    layerswitcherVisible.set('no')
  }
  ;(window as any).settings = new Settings({
    experimentalFeatures: {
      type: 'boolean',
      default: false,
      cb: () => {
        // reportToast(`Experimental features ${value}`);
      },
    },
    mapRotation: {
      type: 'boolean',
      default: false,
    },
    precacheForecast: {
      type: 'boolean',
      default: true,
      cb: (val) => {
        precacheForecast.set(val)
      },
    },
    mapBaseLayer: {
      type: 'string',
      default: 'light',
      cb: (val) => {
        mapBaseLayer.set(val)
      },
    },
    radarColorMapping: {
      type: 'string',
      default: 'classic',
      cb: (value) => {
        radarColorScheme.set(value)
        radarColormap.set(value)
      },
    },
    capability: {
      type: 'string',
      default: 'radar',
    },
    layerMesocyclones: {
      type: 'boolean',
      default: true,
      cb: (value) => {
        cycloneLayerVisible.set(value)
      },
    },
    layerSnow: {
      type: 'boolean',
      default: true,
      cb: (value) => {
        snowLayerVisible.set(value)
      },
    },
    latLonZ: {
      type: 'string',
      default: '49.0,11.0,6',
      source: 'url',
    },
    logo: {
      type: 'string',
      default: dd.isApp() ? 'none' : 'full',
      source: 'url',
      cb: (value) => {
        if (dd.isApp()) {
          logoStyle.set('none')
          return
        }
        logoStyle.set(value)
      },
    },
    layerswitcher: {
      type: 'string',
      default: dd.isApp() ? 'no' : 'yes',
      source: 'url',
      cb: (value) => {
        if (dd.isApp()) {
          layerswitcherVisible.set('no')
          return
        }
        layerswitcherVisible.set(value)
      },
    },
    toolbar: {
      type: 'string',
      default: 'yes',
      source: 'url',
      cb: (value) => {
        toolbarVisible.set(value)
        if (value !== 'yes') {
          bottomToolbarMode.set('hidden')
          document.documentElement.style.setProperty('--attributions-bottom-padding', '0px')
        }
      },
    },
    layerLightning: {
      type: 'boolean',
      default: true,
      cb: (value) => {
        lightningLayerVisible.set(value)
      },
    },
  })
  const [lightningSource, lightningLayer] = makeLightningLayer()
  lightningLayerVisible.subscribe((value) => {
    lightningLayer.setVisible(value)
    ;(window as any).settings.set('layerLightning', value)
  })
  lightningLayerVisible.set((window as any).settings.get('layerLightning'))

  const nb = new NanobarWrapper({})
  const radarSocketIO = io(`${websocketBaseUrl}/radar`)
  radarSocketIO.on('connect', () => {
    logger.log('radar/forecast websocket connected!')
  })

  const strikemgr = new StrikeManager(1000, lightningSource)

  const [mesocycloneSource, mesocycloneLayer] = makeMesocycloneLayer()
  const mesocyclonemgr = new MesoCycloneManager(100, mesocycloneSource)
  cycloneLayerVisible.subscribe((value) => {
    mesocycloneLayer.setVisible(value)
    ;(window as any).settings.set('layerMesocyclones', value)
  })
  cycloneLayerVisible.set((window as any).settings.get('layerMesocyclones'))

  radarSocketIO.on('lightning', (data) => {
    strikemgr.addStrike(data.lon, data.lat)
  })
  ;(window as any).ll = lightningLayer
  radarSocketIO.on('mesocyclones', (data) => {
    mesocyclonemgr.clearAll()
    data.forEach((elem) => mesocyclonemgr.addCyclone(elem))
  })

  let lm = new LayerManager({
    settings: (window as any).settings,
    nanobar: nb,
    capabilities: [
      {
        capability: RadarCapability,
        additionalLayers: [mesocycloneLayer, lightningLayer, labelsOnly(), radolanOverlay()],
        options: {
          nanobar: nb,
          socket_io: radarSocketIO,
        },
      },
      {
        capability: SatelliteCapability,
        additionalLayers: [bordersAndWays()],
        options: {
          nanobar: nb,
          hasBaseLayer: false,
        },
      },
      {
        capability: AerosolsCapability,
        additionalLayers: [bordersAndWays()],
        options: {
          nanobar: nb,
          hasBaseLayer: false,
        },
      },
      {
        capability: LightningCapability,
        additionalLayers: [labelsOnly()],
        options: {
          nanobar: nb,
          hasBaseLayer: true,
          socket: radarSocketIO,
        },
      },
      {
        capability: PrecipitationTypesCapability,
        additionalLayers: [labelsOnly(), radolanOverlay()],
        options: {
          nanobar: nb,
          tileURL: `${apiBaseUrl}/radar/classification`,
        },
      },
    ],
  })
  ;(window as any).lm = lm
  ;(window as any).settings.setCb('mapRotation', (value) => {
    const newView = new View({
      center: lm.getCurrentMap().getView().getCenter(),
      zoom: lm.getCurrentMap().getView().getZoom(),
      minZoom: lm.getCurrentMap().getView().getMinZoom(),
      enableRotation: value,
      extent: lm.getCurrentMap().getView().extent,
    })
    lm.forEachMap((map) => map.setView(newView))
  })
  ;(window as any).settings.setCb('latLonZ', (value) => {
    if (!value) return
    const parts = value.split(',')
    if (parts.length !== 3) return
    const [lat, lon, z] = parts.map(parseFloat)
    lm.getCurrentMap()
      .getView()
      .setCenter(fromLonLat([lon, lat]))
    lm.getCurrentMap().getView().setZoom(z)
  })

  function reloadLightning() {
    fetch(`${dataUrl}/lightning_cache`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then((data) => {
        strikemgr.clearAll()
        data.forEach((elem) => {
          strikemgr.addStrikeWithTime(elem.lon, elem.lat, Math.round(elem.time))
        })
      })
      .then(() => nb.finish(URL))
      .catch((error) => {
        logger.error(error)
      })
  }

  function reloadCyclones() {
    fetch(`${dataUrl}/mesocyclones/all/`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then((data) => {
        mesocyclonemgr.clearAll()
        data.forEach((elem) => mesocyclonemgr.addCyclone(elem))
      })
      .then(() => nb.finish(URL))
      .catch((error) => {
        logger.error(error)
      })
  }

  reloadLightning()
  reloadCyclones()
  ;(window as any).enterForeground = () => {
    lastFocus.set(new Date())
    if (window.matchMedia) {
      colorSchemeDark.set(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark )').matches)
    }
    reloadLightning()
    reloadCyclones()
    if (lm?.refreshTiles) lm.refreshTiles()
  }

  const refreshUnsub = tileRefreshSignal.subscribe((value) => {
    if (!value) return
    if (lm?.refreshTiles) lm.refreshTiles()
  })


  $effect(() => {
    if (postInitCb) postInitCb(lm)
  })

  // Clean up on component destroy
  onDestroy(() => {
    // Clean up LayerManager and its event listeners
    if (lm && lm.destroy) {
      lm.destroy()
    }

    // Clean up UI constants and media query listeners
    cleanupUIConstants()

    // Clean up window.enterForeground function
    if ((window as any).enterForeground) {
      delete (window as any).enterForeground
    }

    // Clean up other global references
    if ((window as any).lm) {
      delete (window as any).lm
    }

    if ((window as any).settings) {
      delete (window as any).settings
    }

    refreshUnsub?.()
  })
</script>

{#if !dd.isApp()}
  <Logo />
{/if}

{#if $toolbarVisible}
  <BottomToolbar layerManager={lm} />
{/if}

<div id="nanobar"></div>
<MapStatusOverlay />
<Map layerManager={lm} />

{#if $toolbarVisible}
  <NowcastPlayback cap={lm.getCapability('radar')} />
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background-color: var(--sl-color-white);
  }

  :global(:root) {
    --toast-stack-offset: 0px;
  }

  :global(.nanobar) {
    width: 100%;
    height: 4px;
    z-index: 999999;
    top: calc(env(safe-area-inset-top) + 0px);
  }
  :global(.bar) {
    width: 0;
    height: 100%;
    background: rgb(135, 202, 214);
    height: 2px;
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 3px rgb(135, 202, 214);
  }

  :global(.toast-stack) {
    position: fixed;
    right: 12px;
    bottom: calc(env(safe-area-inset-bottom) + var(--toast-stack-offset));
    top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1000000;
    max-width: min(360px, 90vw);
    pointer-events: none;
  }

  :global(.toast) {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5em;
    padding: 0.5em 0.75em;
    border-radius: 8px;
    border: 1px solid var(--sl-color-gray-200);
    background: var(--sl-color-white);
    color: var(--sl-color-black);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 150ms ease,
      transform 150ms ease;
    pointer-events: auto;
    font-size: 0.85rem;
  }

  :global(.toast--show) {
    opacity: 1;
    transform: translateY(0);
  }

  :global(.toast--hide) {
    opacity: 0;
    transform: translateY(6px);
  }

  :global(.toast__icon) {
    font-size: 1rem;
  }

  :global(.toast__close) {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 1rem;
    cursor: pointer;
  }

  :global(.toast--primary) {
    border-color: var(--sl-color-primary-600);
  }

  :global(.toast--warning) {
    border-color: var(--sl-color-danger-600);
  }

  :global(*) {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
</style>
