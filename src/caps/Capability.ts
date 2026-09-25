import { Map } from "ol";
import { toLonLat } from "ol/proj";
import { Observable } from "../lib/util";
import type BaseLayer from "ol/layer/Base";
import { sharedCmap } from "../stores";
import type { MapView } from "../stores";
import { elementCentre } from "../lib/viewCentre";

/** Invoked when a capability's map is attached to a DOM node. */
export type TargetCallback = (target: string | HTMLElement) => void;

/**
 * A Capability implements map-related functionality (controller) on an OpenLayers map (view).
 * It has a 1-to-1 relationship to an @OL.Map Object, which must be valid during the entire lifetime
 * of the Capability.
 *
 */
export default class Capability extends Observable {
  map: Map;

  name: string;

  /** The colormap this capability's scale line renders, if it has one. */
  cmap: string | null;

  /** Called when this capability's map is given a DOM target. */
  targetCb: TargetCallback | null;

  constructor(
    map: Map,
    name: string,
    targetCb: TargetCallback | null,
    additionalLayers: BaseLayer[] = [],
  ) {
    super();
    this.map = map;
    this.targetCb = targetCb;
    this.cmap = null;
    this.name = name;

    additionalLayers.forEach((l) => map.addLayer(l));
  }

  setTarget(target: string | HTMLElement | undefined) {
    if (!this.map) return;
    this.map.setTarget(target);
    if (this.targetCb && target) this.targetCb(target);
    if (this.cmap) sharedCmap.set(this.cmap);
  }

  /**
   * Draw into a thumbnail rather than take the map.
   *
   * Only the OpenLayers map is pointed at the element. Not `setTarget`: that
   * runs `targetCb`, which is what a capability does on being *shown* --
   * announce itself as the current layer, fetch what it draws -- and the
   * switcher's thumbnails mount hidden with the app, so every capability was
   * doing all of that on every page load. The lightning view fetched an
   * hour of strikes for a tile nobody had opened.
   */
  setPreviewTarget(target: string | HTMLElement | undefined) {
    this.map?.setTarget(target);
  }

  setCmap(cmap: string) {
    this.cmap = cmap;
    sharedCmap.set(cmap);
  }

  getMap() {
    return this.map;
  }

  getName() {
    return this.name;
  }

  willLoseFocus() {
    super.notify("loseFocus", null);
  }

  /**
   * Where this capability's map is looking, as `mapView` records it, or null
   * while it cannot say: the middle of the map element (lib/viewCentre.ts) and
   * the zoom. The 3D map answers with its own camera.
   */
  currentView(): MapView | null {
    const view = this.map.getView();
    const centre = elementCentre(view);
    if (!centre) return null;
    const [lon, lat] = toLonLat(centre);
    return { lat, lon, zoom: view.getZoom() ?? 0 };
  }

  /**
   * Release anything that outlives the map: socket.io handlers, timers.
   * Optional -- most capabilities hold nothing that needs it. LayerManager
   * calls it on every registered capability when it tears down.
   */
  destroy?(): void;
}
