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
      this.cyclones.splice(idx, 1);
    }
  }

  // Already projected, like the strikes: the Mesocyclone schema documents
  // lat/lon as EPSG:3857 metres. See the note in StrikeManager.
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
    // Backwards, for the same reason as StrikeManager.fadeStrikes.
    for (let idx = this.cyclones.length - 1; idx >= 0; idx -= 1) {
      const id = this.cyclones[idx];
      if (id < now - 30 * MINS) {
        this.removeOne(id, idx);
      }
    }
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
