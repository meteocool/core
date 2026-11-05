import Point from "ol/geom/Point";
import { Feature } from "ol";
import type VectorSource from "ol/source/Vector";
import { rotationSignatures } from "../stores";
import { signaturesOf } from "./rotationSignatures";
import type { Detection } from "./rotationSignatures";

/**
 * The mesocyclone layer: the same ring buffer as StrikeManager, over the
 * `mesocyclones` list, which carries DWD's detections and meteocool's
 * rotation signatures told apart by `source`. A feature is keyed by source
 * and id, so the two never collide; ours also go to the `rotationSignatures`
 * store for the point menu and the storm panel.
 */
export default class MesoCycloneManager {
  /** How many detections to keep before evicting the oldest. */
  maxCyclones: number;

  /** The source the features are drawn from. */
  vs: VectorSource;

  /** Feature keys with the time each was detected, oldest first. */
  cyclones: Array<{ key: string; time: number }>;

  enabled: boolean;

  constructor(maxCyclones: number, vectorSource: VectorSource) {
    this.maxCyclones = maxCyclones;
    this.vs = vectorSource;
    this.cyclones = [];
    this.enabled = true;
  }

  removeOne(key: string, idx: number) {
    const remove = this.vs.getFeatureById(key);
    if (remove) {
      this.vs.removeFeature(remove);
    }
    if (idx !== -1) {
      this.cyclones.splice(idx, 1);
    }
  }

  /** Replace everything with one payload of the list: what the socket sends, and what `/mesocyclones/all/` answers. */
  setAll(detections: Detection[]) {
    this.clearAll();
    detections.forEach((detection) => this.addCyclone(detection));
    rotationSignatures.set(signaturesOf(detections));
  }

  // Already projected, like the strikes: the Mesocyclone schema documents
  // lat/lon as EPSG:3857 metres. See the note in StrikeManager.
  addCyclone(struct: Detection) {
    const source = struct.source ?? "dwd";
    const cyclone = new Feature(new Point([struct.lon, struct.lat]));
    const key = `${source}:${struct.time}`;
    cyclone.setId(key);
    cyclone.set("source", source);
    cyclone.set("intensity", struct.intensity);
    if (source === "meteocool") cyclone.set("signature", struct);
    this.cyclones.push({ key, time: struct.time });
    if (this.cyclones.length > this.maxCyclones) {
      const toRemove = this.cyclones.shift();
      if (toRemove) this.removeOne(toRemove.key, -1);
    }
    return this.vs.addFeature(cyclone);
  }

  // purge old cyclones
  fadeCyclones() {
    const now = new Date().getTime();
    const MINS = 60 * 1000;
    // Backwards, for the same reason as StrikeManager.fadeStrikes.
    for (let idx = this.cyclones.length - 1; idx >= 0; idx -= 1) {
      const { key, time } = this.cyclones[idx];
      if (time < now - 30 * MINS) {
        this.removeOne(key, idx);
      }
    }
    // Not `refresh()`, which clears the source; see StrikeManager.fadeStrikes.
    this.vs.changed();
  }

  clearAll() {
    this.cyclones = [];
    this.vs.clear();
    rotationSignatures.set([]);
  }

  enable(state: boolean) {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}

/* vim: set ts=2 sw=2 expandtab: */
