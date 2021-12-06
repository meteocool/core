import { Observable } from "../lib/util";
import { sharedCmap } from "../stores";

/**
 * A Capability implements map-related functionality (controller) on an OpenLayers map (view).
 * It has a 1-to-1 relationship to an @OL.Map Object, which must be valid during the entire lifetime
 * of the Capability.
 *
 */
export default class Capability extends Observable {
  constructor(map, name, targetCb, additionalLayers) {
    super();
    this.map = map;
    this.targetCb = targetCb;
    this.cmap = null;
    this.name = name;

    additionalLayers.forEach((l) => map.addLayer(l));
  }

  setTarget(target) {
    if (!this.map) return;
    this.map.setTarget(target);
    if (this.targetCb && target) this.targetCb(target);
    if (this.cmap) sharedCmap.set(this.cmap);
  }

  setCmap(cmap) {
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
