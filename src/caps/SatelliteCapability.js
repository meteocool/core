// eslint-disable-next-line import/prefer-default-export
import { sentinel2, sentinel3 } from '../layers/satellite';
import { capDescription, satelliteLayer, showForecastPlaybutton } from '../stores';
import Capability from "./Capability";

const SATELLITE_DESCRIPTION = `Sentinel-2 A / B`;
const SATELLITE_DESCRIPTION_LONG = `
💡 Sentinel-2 A and B are two ESA satellites 🛰 orbiting
earth at 786km. With their multi-spectral cameras, together
they image almost every place on earth 🌍 once every 5 days.
Their ground-resolution is 10 meters per pixel, which might
seem low. But consider that this data is freely available
within a few hours after recording, continuously for all
of Earth. 🚀`;

export default class SatelliteCapability extends Capability {
  constructor() {
    super((map) => {
      satelliteLayer.subscribe((layer) => {
        if (this.oldLayer) {
          map.removeLayer(this.oldLayer);
        }
        switch (layer) {
          case "sentinel2":
            this.oldLayer = sentinel2();
            break;
          case "sentinel3":
          default:
            this.oldLayer = sentinel3();
            break;
        }
        map.addLayer(this.oldLayer);
      });
    }, () => {
      capDescription.set(SATELLITE_DESCRIPTION);
      showForecastPlaybutton.set(false);
    });
    this.oldLayer = null;
  }
}
