// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, showForecastPlaybutton } from '../stores';
import { reportError } from "../lib/Toast";
import Capability from "./Capability";

const WEATHER_DESCRIPTION = `
Temperature at 2m above ground from the ICON weather model.
`;

export default class WeatherCapability extends Capability {
  constructor(options) {
    super(null, () => {
      capDescription.set(WEATHER_DESCRIPTION);
      capLastUpdated.set(null);
      showForecastPlaybutton.set(true);
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
