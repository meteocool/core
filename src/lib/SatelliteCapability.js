// eslint-disable-next-line import/prefer-default-export
export class SatelliteCapability {
  constructor(params) {
    this.map = null;
  }

  setTarget(target) {
    this.map.setTarget(target);
  }

  setMap(map) {
    this.map = map;
  }
}
