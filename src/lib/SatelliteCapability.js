// eslint-disable-next-line import/prefer-default-export
import { sentinel2 } from '../layers/satellite';

export class SatelliteCapability {
  constructor(options) {
    this.map = null;
  }

  setTarget(target) {
    this.map.setTarget(target);
  }

  setMap(map) {
    this.map = map;
    map.addLayer(sentinel2());
  }
}
