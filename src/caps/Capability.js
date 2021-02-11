import { Observable } from '../lib/util';

export class Capability extends Observable {
  constructor(mapCb, targetCb) {
    super();
    this.map = null;
    this.mapCb = mapCb;
    this.targetCb = targetCb;
  }

  setTarget(target) {
    if (!this.map) return;
    this.map.setTarget(target);
    if (this.targetCb && target) this.targetCb(target);
  }

  setMap(map) {
    this.map = map;
    if (this.mapCb && map) this.mapCb(map);
  }

  getMap() {
    return this.map;
  }

  willLoseFocus() {
    super.notify("loseFocus", null);
  }
}
