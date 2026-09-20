import { Map, View } from "ol";
import {
  fromLonLat,
  toLonLat,
  transformExtent,
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
import {
  inspectLatLon, latLon, mapBaseLayer, mapExtent4326, mapTapped, sharedActiveCap,
  zoomlevel,
} from "../stores";
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
 * How long a press has to be held before it counts as asking about a point,
 * and how far it may wander while being held.
 *
 * 450ms is the platform's own long-press dwell, give or take; the slop is
 * deliberately generous, because a finger resting on glass drifts a few pixels
 * without anyone meaning to move it.
 */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

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

  /** One per map: the ring marking the point the forecast strip is sampling. */
  inspectFeatures: Feature[];

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
    this.inspectFeatures = [];
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

    inspectLatLon.subscribe((point) => {
      const geometry = point ? new Point(fromLonLat([point[1], point[0]])) : undefined;
      this.inspectFeatures.forEach((feature) => feature.setGeometry(geometry));
      this.forEachMap((map) => map.render());
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
            // Asking to be located is asking about yourself again.
            inspectLatLon.set(null);
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

    /* The point the forecast strip is sampling, when that is not the client's
       own. A ring rather than a pin: the reading belongs to the point at its
       centre, not to a tip somewhere below it, and it stays legible with the
       radar's own colours underneath. Deliberately nothing like the solid blue
       dot -- the two mean different things and can be on screen together. */
    const inspectFeature = new Feature();
    this.inspectFeatures.push(inspectFeature);
    const inspectLayer = new VectorLayer({
      source: new VectorSource({ features: [inspectFeature] }),
      style: [
        // A dark halo first, so the white ring holds up over a light basemap.
        new Style({
          image: new CircleStyle({
            radius: 11,
            stroke: new Stroke({ color: "rgba(0, 0, 0, 0.35)", width: 5 }),
          }),
        }),
        new Style({
          image: new CircleStyle({
            radius: 11,
            stroke: new Stroke({ color: "#fff", width: 2.5 }),
          }),
        }),
        new Style({
          image: new CircleStyle({
            radius: 2.5,
            fill: new Fill({ color: "#fff" }),
            stroke: new Stroke({ color: "rgba(0, 0, 0, 0.35)", width: 1 }),
          }),
        }),
      ],
      zIndex: 99997,
    });
    inspectLayer.set("kind", "geolocationPositionLayer");

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
    layers = [...layers, inspectLayer, geolocationAccuracyLayer, geolocationPositionLayer];

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
    /* Pressing and holding the map asks what the weather is doing there.
       Deliberately not a tap: a tap is how you dismiss things, re-centre and
       generally poke at a map, and every one of those threw the forecast strip
       up over the view. A hold is a decision, and it is the gesture the
       platform already uses everywhere else to mean "tell me about this".

       On the viewport's own pointer events rather than OpenLayers' map events,
       because OL only types a subset of them; the map coordinate still comes
       from the map, through getEventCoordinate(). */
    const viewport = newMap.getViewport();
    let pressTimer: number | null = null;
    let pressOrigin: [number, number] | null = null;

    const cancelPress = () => {
      if (pressTimer !== null) window.clearTimeout(pressTimer);
      pressTimer = null;
      pressOrigin = null;
    };

    viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      cancelPress();
      // Secondary buttons open the browser's own menu; leave them to it. A
      // second finger means a pinch, which is a zoom and never a question.
      if (event.button > 0 || !event.isPrimary) return;
      if (get(sharedActiveCap) !== newMap.get("capability")) return;
      pressOrigin = [event.clientX, event.clientY];
      const coordinate = newMap.getEventCoordinate(event);
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        pressOrigin = null;
        const capability = newMap.get("capability");
        // A held finger is still a tap as far as the strips are concerned:
        // every layer hears it, only radar samples a point from it, because
        // only radar has a reading that belongs to one.
        mapTapped.update((n) => n + 1);
        // Confirmation that the hold took, before the strip animates in.
        navigator.vibrate?.(12);
        if (capability !== "radar") return;
        const [clickedLon, clickedLat] = toLonLat(coordinate);
        inspectLatLon.set([clickedLat, clickedLon]);
      }, LONG_PRESS_MS);
    });

    /* A hold that wanders is a pan the finger started slowly. The threshold is
       in screen pixels rather than map units, so it does not change meaning
       with the zoom level. */
    viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (!pressOrigin) return;
      const dx = event.clientX - pressOrigin[0];
      const dy = event.clientY - pressOrigin[1];
      if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) cancelPress();
    });
    viewport.addEventListener("pointerup", cancelPress);
    viewport.addEventListener("pointercancel", cancelPress);
    /* The map can also be moved without the pointer moving -- a wheel, a
       keyboard pan, a double-tap zoom -- and a coordinate sampled before that
       is no longer under the finger. */
    newMap.on("movestart", cancelPress);
    /* Otherwise a hold on a touch device races the platform's own selection
       callout, which pops up over the map just as the strip arrives. There is
       no selectable content under it to lose. */
    viewport.addEventListener("contextmenu", (event) => {
      if (get(sharedActiveCap) !== newMap.get("capability")) return;
      event.preventDefault();
    });

    const isApp = dd.isApp();
    newMap.on("moveend", () => {
      if (get(sharedActiveCap) !== newMap.get("capability")) {
        return;
      }
      zoomlevel.set(newMap.getView().getZoom() ?? 0);
      const size = newMap.getSize();
      if (size) {
        mapExtent4326.set(transformExtent(
          newMap.getView().calculateExtent(size),
          "EPSG:3857",
          "EPSG:4326",
        ) as [number, number, number, number]);
      }
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

  /**
   * The map of whichever capability is showing, or undefined before one is.
   *
   * It used to index `capabilities` with a `currentCap` asserted non-null and
   * read `.map` off the result, so anything asking during startup got a
   * TypeError out of a getter rather than a falsy answer.
   */
  getCurrentMap(): Map | undefined {
    return this.currentCap ? this.capabilities[this.currentCap]?.map : undefined;
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
