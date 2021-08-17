import { Observable } from "../lib/util";
import { sharedCmap } from '../stores';

export default class Capability extends Observable {
  constructor(mapCb, targetCb) {
    super();
    this.map = null;
    this.mapCb = [mapCb];
    this.targetCb = targetCb;
    this.cmap = null;
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

  setMap(map) {
    this.map = map;
    if (map) {
      this.mapCb.forEach((cb) => {
        if (cb) cb(map);
      });
    }
  }

  getMap() {
    return this.map;
  }

  willLoseFocus() {
    super.notify("loseFocus", null);
  }

  addMapCb(cb) {
    this.mapCb.push(cb);
    if (this.map) cb(this.map);
  }
}
