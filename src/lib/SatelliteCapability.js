// eslint-disable-next-line import/prefer-default-export
import { sentinel2 } from "../layers/satellite";
import { capDescription } from "../stores";

// eslint-disable-next-line import/prefer-default-export
export class SatelliteCapability {
  // eslint-disable-next-line no-unused-vars
  constructor(options) {
    this.map = null;
  }

  setTarget(target) {
    this.map.setTarget(target);
    capDescription.set("💡 Sentinel-2 A and B are two ESA satellites 🛰 orbiting earth at 786km. With their multi-spectral cameras, together they image almost every place on earth 🌍 once every 5 days. Their ground-resolution is 10 meters per pixel, which might seem low. But consider that this data is freely available within a few hours after recording, continuously for all of Earth. 🚀");
  }

  setMap(map) {
    this.map = map;
    map.addLayer(sentinel2());
  }
}
