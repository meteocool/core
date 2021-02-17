// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated } from '../stores';
import { reportError } from "../lib/Toast";
import { roundToHour } from '../lib/util';
import { Capability } from './Capability';

const WEATHER_DESCRIPTION = `
Temperature at 2m above ground from the ICON weather model.
`;

// eslint-disable-next-line import/prefer-default-export
export class WeatherCapability extends Capability {
  constructor(options) {
    super(null, () => {
      capDescription.set(WEATHER_DESCRIPTION);
      capLastUpdated.set(null);
    });
    this.url = options.tileURL;
    this.nanobar = options.nanobar;
    this.weatherLayer = null;
    this.iconLayers = [];

    this.reloadTilesWeather();
  }

  reloadTilesWeather() {
    this.nanobar.start(this.url);
    fetch(this.url)
      .then((response) => response.json())
      .then((obj) => {
        this.iconLayers = obj;
      })
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }
}
