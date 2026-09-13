import { Map, View } from "ol";
import {
  fromLonLat,
  toLonLat,
} from "ol/proj";
import { defaults } from "ol/control";
import Attribution from "ol/control/Attribution";
import GeolocateControl from "./GeolocateControl";
import { circular as circularPolygon } from "ol/geom/Polygon";

import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Style from "ol/style/Style";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import { get } from "svelte/store";
import { cartoDark, cartoLight, osm, cyclosm } from "../layers/base";
import { latLon, mapBaseLayer, sharedActiveCap, zoomlevel } from "../stores";
import { DeviceDetect as dd } from "./DeviceDetect";
import { satelliteCombo } from "../layers/satellite";
import Capability from "../caps/Capability";
import type Polygon from "ol/geom/Polygon";
import type BaseLayer from "ol/layer/Base";
import LayerGroup from "ol/layer/Group";
import type Settings from "./Settings";
import type NanobarWrapper from "./NanobarWrapper";
import type { CapabilityOptions } from "../caps/options";

/** One entry of the capability list App.svelte builds. */
export interface CapabilityDescriptor {
  /**
   * The capability's name, which each subclass also passes to super(). Named
   * here too so registration can be gated without constructing the capability
   * first -- see src/caps/enabled.ts.
   */
  name: string;
  capability: new (map: Map, additionalLayers: BaseLayer[], options: CapabilityOptions) => Capability;
  additionalLayers?: BaseLayer[];
  options: CapabilityOptions;
}

export interface LayerManagerOptions {
  settings: Settings;
  nanobar?: NanobarWrapper;
  capabilities: CapabilityDescriptor[];
}

let shouldUpdate = true;

/**
 * Manages the reflectivity + forecast layers shown on the map. should be called MapManager XXX
 */
interface CapabilityMap {
    [name: string]: Capability;
}

// How far the map may be panned. Exported because rebuilding the View -- which
// the mapRotation setting does -- has to reapply it: OpenLayers keeps the
// configured extent private, so it cannot be read back off an existing View.
export const VIEW_EXTENT = [...fromLonLat([-190.0, -75.0]), ...fromLonLat([190.0, 62.0])];

export class LayerManager {
  options: LayerManagerOptions;

  settings: Settings;

  capabilities: CapabilityMap;

  maps: Map[];

  accuracyFeatures: Feature[];

  positionFeatures: Feature[];

  /** The capability currently attached to the main map. */
  currentCap: string | null;

  mapCount: number;

  /** Kept so destroy() can take the history listener off window again. */
  popstateHandler: ((event: PopStateEvent) => void) | null = null;

  constructor(options) {
    this.options = options;
    this.settings = options.settings;
    this.capabilities = {};
    this.maps = [];
    this.accuracyFeatures = [];
    this.positionFeatures = [];
    this.currentCap = null;
    this.mapCount = 0;

    options.capabilities.forEach((capability) => {
      const newMap = this.mapFactory(capability.options.hasBaseLayer);
       
      const newCap = new capability.capability(newMap, capability.additionalLayers || [], capability.options);
      this.capabilities[newCap.getName()] = newCap;
      newMap.set("capability", newCap.getName());
      this.maps.push(newMap);
    });

    this.capabilities[this.startingCapability()].setTarget(document.getElementById("map") ?? undefined);

    mapBaseLayer.subscribe((newBaseLayer) => {
      this.switchBaseLayer(newBaseLayer);
    });
  }

  // XXX move somewhere else
  updateLocation(lat: number, lon: number, accuracy: number, zoom: boolean | number = false, focus = true) {
    let accuracyPoly: Polygon | null = null;
    if (accuracy >= 0) {
      accuracyPoly = circularPolygon([lon, lat], accuracy, 64);
      // OL 10 types getTransformFromProjections as nullable; Geometry.transform
      // looks the pair up itself and says the same thing in one call.
      accuracyPoly.transform("EPSG:4326", "EPSG:3857");
    }
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(accuracyPoly ?? undefined));
    let centerPoint;
    const center = fromLonLat([lon, lat]);
    if (lat === -1 && lon === -1 && accuracy === -1) {
      centerPoint = null;
      latLon.set(null);
    } else {
      centerPoint = center ? new Point(center) : null;
      latLon.set([lat, lon]);
    }
    this.positionFeatures.forEach((feature) => feature.setGeometry(centerPoint));

    if (centerPoint === null) return;

    const view = this.maps[0].getView();
    let zoomLevel = view.getZoom();
    const oldCenter = view.getCenter();
    if (zoom) {
      if (accuracy < 800) {
        zoomLevel = 10;
      } else if (accuracy < 2000) {
        zoomLevel = 9;
      } else {
        zoomLevel = 8;
      }
    }
    let newCenter;
    if (focus) {
      newCenter = center;
    } else {
      newCenter = oldCenter;
    }
    if (zoom || focus) {
      view.animate({ center: newCenter, zoom: zoomLevel, duration: 500 });
    }
    this.forEachMap((map) => map.render());
  }

  resetLocation() {
    this.positionFeatures.forEach((feature) => feature.setGeometry(undefined));
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(undefined));
  }

  mapFactory(baselayer: boolean | undefined = true) {
    let controls;
    if (!dd.isApp()) {
      controls = defaults({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
        }),
        new GeolocateControl({
          onLocate: () => {
            navigator.geolocation.getCurrentPosition(({ coords }) => {
              this.updateLocation(coords.latitude, coords.longitude, coords.accuracy, true, true);
            });
          },
        }),
      ]);
    }

    const accuracyFeature = new Feature();
    this.accuracyFeatures.push(accuracyFeature);
    const positionFeature = new Feature();
    this.positionFeatures.push(positionFeature);
    const src = new VectorSource({
      features: [positionFeature],
    });
    src.set("kind", "geolocationPositionLayer");
    const geolocationPositionLayer = new VectorLayer({
      source: src,
      style: new Style({
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({
            color: "#048EF9",
          }),
          stroke: new Stroke({
            color: "#fff",
            width: 3.5,
          }),
        }),
      }),
      zIndex: 99999,
    });
    const geolocationAccuracyLayer = new VectorLayer({
      source: new VectorSource({
        features: [accuracyFeature],
      }),
      zIndex: 99998,
    });
    geolocationAccuracyLayer.set("kind", "geolocationPositionLayer");

    let lat = 51.0;
    let lon = 11.0;
    let z = 6;

    const parts = String(this.settings.get("latLonZ") ?? "").split(",");
    if (parts.length === 3) {
      [lat, lon, z] = parts.map(parseFloat);
    }

    let layers: BaseLayer[] = [];
    if (baselayer) {
      layers = [this.baseLayerFactory(this.settings.get("mapBaseLayer"))];
    }
    layers = [...layers, geolocationAccuracyLayer, geolocationPositionLayer];

    const newMap = new Map({
      layers,
      view: this.maps.length > 0 ?
        this.maps[0].getView() :
        new View({
          zoom: z,
          center: fromLonLat([lon, lat]),
          enableRotation: Boolean(this.settings.get("mapRotation")),
          constrainResolution: false,
          extent: VIEW_EXTENT,
          minZoom: 3,
        }),
      controls,
    });
    const isApp = dd.isApp();
    newMap.on("moveend", () => {
      if (get(sharedActiveCap) !== newMap.get("capability")) {
        return;
      }
      zoomlevel.set(newMap.getView().getZoom() ?? 0);
      if (isApp) return;
      if (!shouldUpdate) {
        // do not update the URL when the view was changed in the 'popstate' handler
        shouldUpdate = true;
        return;
      }

      const center = newMap.getView().getCenter();
      if (!center) return;
      const center4326 = toLonLat(center);
      const url = new URL(window.location.href);
      url.searchParams.set(
        "latLonZ",
        `${center4326[1].toFixed(6)},${center4326[0].toFixed(6)},${(newMap.getView().getZoom() ?? 0).toFixed(2)}`,
      );
      window.history.pushState({ location: url.toString() }, `meteocool 2.0 ${window.location.toString()}`, url.toString());
    });

    if (this.mapCount === 0) {
      // restore the view state when navigating through the history, see
      // https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onpopstate
      this.popstateHandler = (event) => {
        if (event.state === null) {
          return;
        }
        shouldUpdate = false;
        const url = new URL(event.state.location);
        if (url.searchParams.has("latLonZ")) {
          this.settings.cb("latLonZ");
        }
      };
      window.addEventListener("popstate", this.popstateHandler);
    }
    this.mapCount += 1;
    newMap.set("baselayer", baselayer);
    return newMap;
  }

  baseLayerFactory(layer) {
    switch (layer) {
      case "osm":
        return osm();
      case "dark":
        return cartoDark();
      case "satellite":
        return satelliteCombo();
      case "cyclosm":
        return cyclosm();
      case "light":
      case "topographic":
      default:
        return cartoLight();
    }
  }

  switchBaseLayer(newBaseLayer: string) {
    this.forEachMap((map) => {
      if (map.get("baselayer") === false) return;
      map
        .getLayers()
        .getArray()
        .filter((layer) => layer.get("base") === true)
        .forEach((layer) => map.removeLayer(layer));
      if (newBaseLayer) map.addLayer(this.baseLayerFactory(newBaseLayer));
    });
  }

  forEachMap(cb: (map: Map, capability: string) => void) {
    this.maps.forEach((map) => cb(map, map.get("capability")));
  }

  getCurrentMap() {
    return this.capabilities[this.currentCap!].map;
  }

  getCapability(name: string) {
    return this.capabilities[name];
  }

  setTarget(cap: string, target: string | HTMLElement | undefined) {
    console.log(cap);
    if (this.currentCap && cap !== this.currentCap) {
      this.capabilities[this.currentCap].willLoseFocus();
    }
    this.capabilities[cap].setTarget(target);
    sharedActiveCap.set(cap);
    this.currentCap = cap;
  }

  setDefaultTarget(target: string | HTMLElement | undefined) {
    const capability = this.startingCapability();
    console.log(`Starting with default cap ${capability}`);
    this.setTarget(capability, target);
  }

  /**
   * The capability to open with: the stored one, unless it is not registered.
   * A setting persisted while a capability was still offered outlives it being
   * withdrawn, and indexing capabilities with it would throw on startup.
   */
  private startingCapability(): string {
    const stored = String(this.settings.get("capability"));
    if (stored in this.capabilities) return stored;
    const fallback = Object.keys(this.capabilities)[0];
    console.warn(`Capability ${stored} is not registered; starting with ${fallback}`);
    return fallback;
  }

  /**
   * Re-request every tile in every map.
   *
   * Wired to the connection banner's retry button: coming back online does not
   * by itself make OpenLayers retry the tiles that failed while it was down.
   */
  refreshTiles() {
    const refreshLayer = (layer: BaseLayer) => {
      if (layer instanceof LayerGroup) {
        layer.getLayers().forEach((inner: BaseLayer) => refreshLayer(inner));
        return;
      }
      const source = (layer as BaseLayer & { getSource?: () => unknown }).getSource?.();
      const refreshable = source as { refresh?: () => void; changed?: () => void } | undefined;
      if (refreshable?.refresh) {
        refreshable.refresh();
      } else if (refreshable?.changed) {
        refreshable.changed();
      }
    };

    this.forEachMap((map) => {
      map.getLayers().forEach((layer) => refreshLayer(layer as BaseLayer));
    });
  }

  /**
   * Release everything that outlives the maps. Capabilities hold socket.io
   * handlers and timers that the map itself knows nothing about, so they have
   * to be told; destroy() is optional on Capability and most do not define it.
   */
  destroy() {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
      this.popstateHandler = null;
    }
    Object.values(this.capabilities).forEach((cap) => cap.destroy?.());
  }
}

/* vim: set ts=2 sw=2 expandtab: */
