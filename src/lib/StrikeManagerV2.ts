import Point from "ol/geom/Point";
import { Feature } from "ol";
import VectorSource from "ol/source/Vector";

interface Strike {
  lat: number;
  lon: number;
}

interface LightningMap {
  [time: string]: Feature;
}

export const TIME_KEY = "time_wall_ns";

export default class StrikeManagerV2 {
  /** Reference to associated VectorSource. */
  vs: VectorSource;

  /** Map with locally managed lightning strikes (those not in a VectorTileLayer) */
  strikes: LightningMap;

  /** Baseline timestamp in ms, i.e. the lower bound of the timestamp of locally managed strikes */
  baseline: number;

  constructor(vectorSource: VectorSource, baseline = 0) {
    this.vs = vectorSource;
    this.strikes = {}; // key = time, value = OL object reference
    this.baseline = baseline;
  }

  setBaseline(baseline: number) {
    const keys = Object.keys(this.strikes).map(parseInt);
    keys.forEach((key) => {
      if (key < baseline) {
        this.vs.removeFeature(this.strikes[key]);
        delete this.strikes[key.toString()];
      }
    });
    this.baseline = baseline;
  }

  addStrike(lon: number, lat: number, timestamp: number) {
    const strike = new Feature(new Point([lon, lat]));
    strike.set(TIME_KEY, timestamp);
    this.strikes[timestamp.toString()] = strike;
    this.vs.addFeature(strike);
  }
}
