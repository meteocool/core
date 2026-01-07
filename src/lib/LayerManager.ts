import { Map, View } from 'ol'
import { fromLonLat, getTransformFromProjections, get as getProjection, toLonLat } from 'ol/proj'
import { defaults } from 'ol/control'
import Attribution from 'ol/control/Attribution'
import { circular as circularPolygon } from 'ol/geom/Polygon'
import BaseLayer from 'ol/layer/Base'

import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import Style from 'ol/style/Style'
import CircleStyle from 'ol/style/Circle'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import { get } from 'svelte/store'
import { cartoDark, cartoLight, osm, cyclosm } from '../layers/base'
import { latLon, mapBaseLayer, sharedActiveCap, zoomlevel } from '../stores'
import { DeviceDetect as dd } from './DeviceDetect'
import { satelliteCombo } from '../layers/satellite'
import { logger } from './logger.js'
import Capability from '../caps/Capability'
import GeolocateControl from './GeolocateControl'

let shouldUpdate = true

// Type definitions
interface Settings {
  get(_key: string): any
  set(_key: string, _value: any): void
  setCb(_key: string, _callback: (_value: any) => void): void
  cb(_key: string): void
}

interface NanobarWrapper {
  finish(_url?: string): void
}

interface CapabilityOptions {
  capability: typeof Capability
  additionalLayers?: BaseLayer[]
  options: {
    hasBaseLayer: boolean
    nanobar?: NanobarWrapper
    [key: string]: any
  }
}

interface LayerManagerOptions {
  settings: Settings
  nanobar?: NanobarWrapper
  capabilities: CapabilityOptions[]
}

/**
 * Manages the reflectivity + forecast layers shown on the map. should be called MapManager XXX
 */

interface CapabilityMap {
  [name: string]: Capability
}

export class LayerManager {
  options: LayerManagerOptions

  settings: Settings

  capabilities: CapabilityMap

  maps: Map[]

  accuracyFeatures: Feature[]

  positionFeatures: Feature[]

  currentCap: string | null

  mapCount: number

  popstateHandler: ((_event: any) => void) | null = null

  constructor(options: LayerManagerOptions) {
    this.options = options
    this.settings = options.settings
    this.capabilities = {}
    this.maps = []
    this.accuracyFeatures = []
    this.positionFeatures = []
    this.currentCap = null
    this.mapCount = 0

    options.capabilities.forEach((capability) => {
      const newMap = this.mapFactory(capability.options.hasBaseLayer)

      const newCap = new (capability.capability as any)(newMap, capability.additionalLayers || [], capability.options) as Capability
      this.capabilities[newCap.getName()] = newCap
      newMap.set('capability', newCap.getName())
      this.maps.push(newMap)
    })

    // Note: Map target will be set by Map.svelte's mapInit function after component mounts
    // const active = this.settings.get("capability");
    // this.capabilities[active].setTarget(document.getElementById("map"));

    mapBaseLayer.subscribe((newBaseLayer: string) => {
      this.switchBaseLayer(newBaseLayer)
    })
  }

  // XXX move somewhere else
  updateLocation(lat: number, lon: number, accuracy: number, zoom = false, focus = true) {
    let accuracyPoly = null
    if (accuracy >= 0) {
      accuracyPoly = circularPolygon([lon, lat], accuracy, 64)
      const sourceProj = getProjection('EPSG:4326')
      const targetProj = getProjection('EPSG:3857')
      if (sourceProj && targetProj) {
        const transform = getTransformFromProjections(sourceProj, targetProj)
        if (transform) {
          accuracyPoly.applyTransform(transform)
        }
      }
    }
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(accuracyPoly || undefined))
    let centerPoint
    const center = fromLonLat([lon, lat])
    if (lat === -1 && lon === -1 && accuracy === -1) {
      centerPoint = null
      latLon.set(null)
    } else {
      centerPoint = center ? new Point(center) : null
      latLon.set([lat, lon] as any)
    }
    this.positionFeatures.forEach((feature) => feature.setGeometry(centerPoint || undefined))

    if (centerPoint === null) return

    const view = this.maps[0].getView()
    let zoomLevel = view.getZoom()
    const oldCenter = view.getCenter()
    if (zoom) {
      if (accuracy < 800) {
        zoomLevel = 10
      } else if (accuracy < 2000) {
        zoomLevel = 9
      } else {
        zoomLevel = 8
      }
    }
    let newCenter
    if (focus) {
      newCenter = center
    } else {
      newCenter = oldCenter
    }
    if (zoom || focus) {
      view.animate({ center: newCenter, zoom: zoomLevel, duration: 500 })
    }
    this.forEachMap((map) => map.render())
  }

  resetLocation() {
    this.positionFeatures.forEach((feature) => feature.setGeometry(undefined))
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(undefined))
  }

  mapFactory(baselayer = true) {
    let controls
    if (!dd.isApp()) {
      controls = defaults({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
        }),
      ])
    }

    const accuracyFeature = new Feature()
    this.accuracyFeatures.push(accuracyFeature)
    const positionFeature = new Feature()
    this.positionFeatures.push(positionFeature)
    const src = new VectorSource({
      features: [positionFeature],
    })
    src.set('kind', 'geolocationPositionLayer')
    const geolocationPositionLayer = new VectorLayer({
      source: src,
      style: new Style({
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({
            color: '#048EF9',
          }),
          stroke: new Stroke({
            color: '#fff',
            width: 3.5,
          }),
        }),
      }),
      zIndex: 99999,
    })
    const geolocationAccuracyLayer = new VectorLayer({
      source: new VectorSource({
        features: [accuracyFeature],
      }),
      zIndex: 99998,
    })
    geolocationAccuracyLayer.set('kind', 'geolocationPositionLayer')

    let lat = 51.0
    let lon = 11.0
    let z = 6

    const parts = this.settings.get('latLonZ').split(',')
    if (parts.length === 3) {
      ;[lat, lon, z] = parts.map(parseFloat)
    }

    let layers: BaseLayer[] = []
    if (baselayer) {
      layers = [this.baseLayerFactory(this.settings.get('mapBaseLayer'))]
    }
    layers = [...layers, geolocationAccuracyLayer, geolocationPositionLayer]

    const newMap = new Map({
      layers,
      view:
        this.maps.length > 0
          ? this.maps[0].getView()
          : new View({
              zoom: z,
              center: fromLonLat([lon, lat]),
              enableRotation: this.settings.get('mapRotation'),
              constrainResolution: false,
              extent: [...fromLonLat([-190.0, -75.0]), ...fromLonLat([190.0, 62.0])],
              minZoom: 3,
            }),
      controls,
    })

    // Add native-styled geolocate control (top-left, below zoom)
    if (!dd.isApp()) {
      const locate = new GeolocateControl({
        onLocate: () => {
          if (!('geolocation' in navigator)) return
          navigator.geolocation.getCurrentPosition(
            (position) => {
              // zoom = true, focus = true
              this.updateLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy ?? 1, true, true)
            },
            () => {
              // silently ignore errors; control stays enabled
            },
          )
        },
        title: 'Locate me',
      })
      newMap.addControl(locate)
    }
    const isApp = dd.isApp()
    newMap.on('moveend', () => {
      if (get(sharedActiveCap) !== newMap.get('capability')) {
        return
      }
      const zoom = newMap.getView().getZoom()
      if (zoom !== undefined) {
        zoomlevel.set(zoom)
      }
      if (isApp) return
      if (!shouldUpdate) {
        // do not update the URL when the view was changed in the 'popstate' handler
        shouldUpdate = true
        return
      }

      const center = newMap.getView().getCenter()
      if (center) {
        const center4326 = toLonLat(center)
        const zoom = newMap.getView().getZoom()
        if (zoom !== undefined) {
          const url = new URL(window.location.href)
          url.searchParams.set('latLonZ', `${center4326[1].toFixed(6)},${center4326[0].toFixed(6)},${zoom.toFixed(2)}`)
          window.history.pushState({ location: url.toString() }, `meteocool 2.0 ${window.location.toString()}`, url.toString())
        }
      }
    })

    if (this.mapCount === 0) {
      // restore the view state when navigating through the history, see
      // https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onpopstate
      this.popstateHandler = (event) => {
        if (event.state === null) {
          return
        }
        shouldUpdate = false
        const url = new URL(event.state.location)
        if (url.searchParams.has('latLonZ')) {
          this.settings.cb('latLonZ')
        }
      }
      window.addEventListener('popstate', this.popstateHandler)
    }
    this.mapCount += 1
    newMap.set('baselayer', baselayer)
    return newMap
  }

  baseLayerFactory(layer: string) {
    switch (layer) {
      case 'osm':
        return osm()
      case 'dark':
        return cartoDark()
      case 'satellite':
        return satelliteCombo()
      case 'cyclosm':
        return cyclosm()
      case 'light':
      case 'topographic':
      default:
        return cartoLight()
    }
  }

  switchBaseLayer(newBaseLayer: string) {
    this.forEachMap((map) => {
      if (map.get('baselayer') === false) return
      map
        .getLayers()
        .getArray()
        .filter((layer) => layer.get('base') === true)
        .forEach((layer) => map.removeLayer(layer))
      if (newBaseLayer) map.addLayer(this.baseLayerFactory(newBaseLayer))
    })
  }

  forEachMap(cb: (_map: Map, _capability: string) => void) {
    this.maps.forEach((map) => cb(map, map.get('capability')))
  }

  getCurrentMap() {
    return this.currentCap ? this.capabilities[this.currentCap].map : null
  }

  getCapability(name: string) {
    return this.capabilities[name]
  }

  setTarget(cap: string, target: string | HTMLElement) {
    logger.log(cap)
    if (
      this.currentCap &&
      this.capabilities[this.currentCap].willLoseFocus &&
      typeof this.capabilities[this.currentCap].willLoseFocus === 'function' &&
      cap !== this.currentCap
    ) {
      this.capabilities[this.currentCap].willLoseFocus()
    }
    this.capabilities[cap].setTarget(target)
    sharedActiveCap.set(cap)
    this.currentCap = cap
  }

  setDefaultTarget(target: string | HTMLElement) {
    logger.log(`Starting with default cap ${this.settings.get('capability')}`)
    this.setTarget(this.settings.get('capability'), target)
  }

  destroy() {
    // Clean up event listeners
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler)
      this.popstateHandler = null
    }

    // Destroy all capabilities
    Object.values(this.capabilities).forEach((cap) => {
      if (cap.destroy && typeof cap.destroy === 'function') {
        cap.destroy()
      }
    })
  }
}

/* vim: set ts=2 sw=2 expandtab: */
