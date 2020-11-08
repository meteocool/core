// eslint-disable-next-line import/prefer-default-export
import { reportError } from './Toast';
import { dwdLayer } from '../layers/radar';

export class RadarCapability {
  constructor(options) {
    this.map = null;
    this.layer = null;
    this.nanobar = options.nanobar;
    this.url = options.tileURL;
    this.nanobar.start(this.url);
    fetch(this.url)
      .then((response) => response.json())
      .then((obj) => this.processReflectivity(obj))
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }

  processReflectivity(obj) {
    Object.keys(obj).forEach((k) => {
      if (k === 'reflectivity') {
        const newLayer = dwdLayer(obj[k]);
        if (this.map) {
          if (this.layer) this.map.removeLayer(this.layer);
          this.map.addLayer(newLayer);
        }
        this.layer = newLayer;
      }
    });
  }

  setTarget(target) {
    this.map.setTarget(target);
  }

  setMap(map) {
    this.map = map;
    if (this.layer) {
      this.map.addLayer(this.layer);
    }
  }
}
