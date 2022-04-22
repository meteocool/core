import Point from 'ol/geom/Point';
import { Feature } from 'ol';

export default class StrikeManagerV2 {
  constructor(vectorSource, baseline = 0) {
    this.vs = vectorSource;
    this.strikes = {}; // key = time, value = OL object reference
    this.enabled = true;
    this.baseline = baseline;
  }

  setBaseline(baseline) {
    const keys = Object.keys(this.strikes)
      .map(parseInt);
    keys.forEach((key, idx) => {
      if (key < baseline) {
        this.vs.removeFeature(this.strikes[key]);
        delete this.strikes[key.toString()];
      }
    });
  }

  addStrike(lon, lat, timestamp) {
    if (timestamp > this.baseline) {
      const strike = new Feature(new Point([lon, lat]));
      strike.set('time_wall', timestamp);
      this.strikes[timestamp.toString()] = strike;
      this.vs.addFeature(strike);
    }
  }

  addStrikes(lst) {
    lst.forEach((elem) => this.addStrike(elem.lon, elem.lat, elem.time_wall));
  }
}
