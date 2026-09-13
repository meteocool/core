import Point from "ol/geom/Point";
import { Feature } from "ol";
import type VectorSource from "ol/source/Vector";

/** The mesocyclone layer: the same ring buffer as StrikeManager, over detections. */
export default class MesoCycloneManager {
  /** How many detections to keep before evicting the oldest. */
  maxCyclones: number;

  /** The source the features are drawn from. */
  vs: VectorSource;

  /** Feature ids, oldest first. */
  cyclones: number[];

  enabled: boolean;

  constructor(maxCyclones: number, vectorSource: VectorSource) {
    this.maxCyclones = maxCyclones;
    this.vs = vectorSource;
    this.cyclones = [];
    this.enabled = true;
  }

  removeOne(id, idx) {
    const remove = this.vs.getFeatureById(id);
    if (remove) {
      this.vs.removeFeature(remove);
    }
    if (idx !== -1) {
      this.cyclones = this.cyclones.slice(0, idx).concat(this.cyclones.slice(idx + 1, this.cyclones.length));
    }
  }

  addCyclone(struct) {
    const cyclone = new Feature(new Point([struct.lon, struct.lat]));
    cyclone.setId(struct.time);
    cyclone.set("intensity", struct.intensity);
    this.cyclones.push(cyclone.getId() as number);
    if (this.cyclones.length > this.maxCyclones) {
      const toRemove = this.cyclones.shift();
      this.removeOne(toRemove, -1);
    }
    return this.vs.addFeature(cyclone);
  }

  // purge old cyclones
  fadeCyclones() {
    const now = new Date().getTime();
    const MINS = 60 * 1000;
    this.cyclones.forEach((id, idx) => {
      if (id < now - 30 * MINS) {
        this.removeOne(id, idx);
      }
    });
    this.vs.refresh();
  }

  clearAll() {
    this.cyclones = [];
    this.vs.clear();
  }

  enable(state) {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}

/* vim: set ts=2 sw=2 expandtab: */
