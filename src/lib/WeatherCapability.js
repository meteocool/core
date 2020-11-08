// eslint-disable-next-line import/prefer-default-export
export class WeatherCapability {
  constructor(params) {
    this.map = null;
  }

  setTarget(target) {
    this.map.setTarget(target);
    window.map = this.map;
  }

  setMap(map) {
    this.map = map;
  }
}
