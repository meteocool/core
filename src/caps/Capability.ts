import { Map } from "ol";
import { toLonLat } from "ol/proj";
import { Observable } from "../lib/util";
import type BaseLayer from "ol/layer/Base";
import { sharedCmap } from "../stores";
import type { MapView } from "../stores";
import { elementCentre } from "../lib/viewCentre";

/** Invoked when a capability's map is attached to a DOM node. */
export type TargetCallback = (target: string | HTMLElement) => void;

/** The client's own position as `LayerManager.updateLocation` was given it; accuracy in metres, negative for none. */
export interface UserLocation {
  lat: number;
  lon: number;
  accuracy: number;
}

/**
 * A Capability implements map functionality (controller) on an OpenLayers map (view).
 * Each Capability owns exactly one @OL.Map object, which must stay valid for the
 * Capability's whole lifetime.
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
   * Only the OpenLayers map is pointed at the element. `setTarget` would also
   * run `targetCb`, which is what a capability does when it is *shown*: it
   * announces itself as the current layer and fetches what it draws. The
   * switcher's thumbnails mount hidden with the app, so every capability would
   * do all of that on every page load. The lightning view fetched an hour of
   * strikes for a tile nobody had opened.
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
   * Optional; most capabilities hold nothing that needs it. LayerManager
   * calls it on every registered capability when it tears down.
   */
  destroy?(): void;

  /**
   * Catch up after the page or the network has been away (lib/wakeup.ts):
   * refetch whatever the socket would have announced meanwhile, and whatever
   * failed while the network was down. LayerManager calls it on the
   * capability showing. Optional; the radar keeps itself current from
   * `lastFocus` whether it is showing or not.
   */
  resync?(): void;

  /**
   * Mark the client's own position, or take the mark down for null.
   * LayerManager calls it on every capability with whatever the apps or the
   * browser last reported. Optional, since every OpenLayers map already carries
   * LayerManager's blue dot; only a capability drawing a map of its own needs
   * to draw it again.
   */
  showLocation?(location: UserLocation | null): void;

  /**
   * Move this capability's own camera to `centre` ([lon, lat]) and `zoom`, in
   * the flat map's zoom levels, either left as it is for null. True when it
   * did; false leaves LayerManager to animate the shared View instead.
   * Optional; only a map whose camera leads the View needs it.
   */
  lookAt?(centre: [number, number] | null, zoom: number | null): boolean;

  /**
   * Turn this capability's map by a two-finger rotation, `degrees` clockwise
   * since the fingers went down, or let go of it for null. True when it
   * turned. Optional; only a map that turns needs it. See
   * `LayerManager.turnMap`.
   */
  turn?(degrees: number | null): boolean;
}
