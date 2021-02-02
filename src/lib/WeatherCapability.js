// eslint-disable-next-line import/prefer-default-export
import { capDescription } from "../stores";
import { reportError } from "./Toast";
import { weatherLayer } from "../layers/weather";

function roundToHour(date) {
  const p = 60 * 60 * 1000; // milliseconds in an hour
  return new Date(Math.round(date.getTime() / p) * p).getHours();
}

// eslint-disable-next-line import/prefer-default-export
export class WeatherCapability {
  constructor(options) {
    this.map = null;
    this.url = options.tileURL;
    this.nanobar = options.nanobar;
    this.weatherLayer = null;

    this.reloadTilesWeather();
  }

  reloadTilesWeather() {
    this.nanobar.start(this.url);
    fetch(this.url)
      .then((response) => response.json())
      .then((obj) => {
        const h = obj.filter((elem) => elem.hour === roundToHour(new Date()))[0];
        console.log(h);
        this.weatherLayer = weatherLayer(h.tile_id);
        if (this.map != null) {
          this.map.addLayer(this.weatherLayer);
          this.weatherLayer = null;
        }
      })
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }

  setTarget(target) {
    this.map.setTarget(target);
    capDescription.set("Temperature at 2m above ground from the ICON weather model.");
  }

  setMap(map) {
    this.map = map;
    if (this.weatherLayer != null) map.addLayer(this.weatherLayer);
  }
}
