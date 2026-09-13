import Point from "ol/geom/Point";
import { Feature } from "ol";
import type VectorSource from "ol/source/Vector";

/**
 * The strike layer used by the radar capability: a ring buffer of features,
 * keyed by the strike time that is also their feature id.
 */
export default class StrikeManager {
  /** How many strikes to keep before evicting the oldest. */
  maxStrikes: number;

  /** The source the features are drawn from. */
  vs: VectorSource;

  /** Feature ids, oldest first. */
  strikes: number[];

  enabled: boolean;

  constructor(maxStrikes: number, vectorSource: VectorSource) {
    this.maxStrikes = maxStrikes;
    this.vs = vectorSource;
    this.strikes = [];
    this.enabled = true;
  }

  addStrike(lon: number, lat: number, addCb: ((feature: Feature) => void) | null = null) {
    return this.addStrikeWithTime(lon, lat, new Date().getTime(), addCb);
  }

  removeOne(id: number, idx: number) {
    const remove = this.vs.getFeatureById(id);
    if (remove) {
      this.vs.removeFeature(remove);
    }
    if (idx !== -1) {
      this.strikes.splice(idx, 1);
    }
  }

  // Coordinates arrive already projected. Both the `lightning` websocket event
  // and /lightning_cache document lat/lon as "EPSG:3857 northing/easting, in
  // metres" (src/api/generated/data.ts), so they are used as they are. Passing
  // them through fromLonLat reads as the obvious fix -- it is what the
  // vibeocool branch does -- but it multiplies them by ~111319 and throws every
  // strike off the map.
  addStrikeWithTime(lon: number, lat: number, time: number, addCb: ((feature: Feature) => void) | null = null) {
    if (!this.enabled) return false;
    const lightning = new Feature(new Point([lon, lat]));
    lightning.setId(time);
    this.strikes.push(lightning.getId() as number);
    if (this.strikes.length > this.maxStrikes) {
      const toRemove = this.strikes.shift();
      if (toRemove !== undefined) this.removeOne(toRemove, -1);
    }
    if (addCb) {
      addCb(lightning);
    }
    return this.vs.addFeature(lightning);
  }

  // purge old strikes
  fadeStrikes() {
    const now = new Date().getTime();
    const MINS = 60 * 1000;
    // Backwards: removeOne splices, so a forward walk skips the element that
    // slides into the index it just vacated.
    for (let idx = this.strikes.length - 1; idx >= 0; idx -= 1) {
      const id = this.strikes[idx];
      if (id < now - 30 * MINS) {
        this.removeOne(id, idx);
      }
    }
    this.vs.refresh();
  }

  clearAll() {
    this.strikes = [];
    this.vs.clear();
  }

  debug() {
    console.log(this.strikes);
    console.log(this.vs.getFeatures());
  }

  enable(state: boolean) {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
