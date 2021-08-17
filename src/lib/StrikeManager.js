import Point from "ol/geom/Point";
import { Feature } from "ol";

export default class StrikeManager {
  constructor(maxStrikes, vectorSource) {
    this.maxStrikes = maxStrikes;
    this.vs = vectorSource;
    this.strikes = [];
    this.enabled = true;
  }

  addStrike(lon, lat, addCb = null) {
    return this.addStrikeWithTime(lon, lat, new Date().getTime(), addCb);
  }

  removeOne(id, idx) {
    const remove = this.vs.getFeatureById(id);
    if (remove) {
      this.vs.removeFeature(remove);
    }
    if (idx !== -1) {
      this.strikes = this.strikes.slice(0, idx).concat(this.strikes.slice(idx + 1, this.strikes.length));
    }
  }

  addStrikeWithTime(lon, lat, time, addCb = null) {
    if (!this.enabled) return false;
    const lightning = new Feature(new Point([lon, lat]));
    lightning.setId(time);
    this.strikes.push(lightning.getId());
    if (this.strikes.length > this.maxStrikes) {
      const toRemove = this.strikes.shift();
      this.removeOne(toRemove, -1);
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
    this.strikes.forEach((id, idx) => {
      if (id < now - 30 * MINS) {
        this.removeOne(id, idx);
      }
    });
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

  enable(state) {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
