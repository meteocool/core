import { Map } from "ol";
import { Observable } from "../lib/util";
import type BaseLayer from "ol/layer/Base";
import { sharedCmap } from "../stores";

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
}
