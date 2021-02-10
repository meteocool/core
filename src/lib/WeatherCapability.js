// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated } from '../stores';
import { reportError } from "./Toast";
import { weatherLayer } from "../layers/weather";
import { roundToHour } from './util';

// eslint-disable-next-line import/prefer-default-export
export class WeatherCapability {
  constructor(options) {
    this.map = null;
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
        this.onSliderChange(roundToHour(new Date()));
      })
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }


  onSliderChange(newVal) {
    if (!newVal) return;
    const h = this.iconLayers.filter(
      (elem) => elem.hour === newVal,
    )[0];
    console.log(h);
    const [newWeatherSource, newWeatherLayer] = weatherLayer(h.tile_id);

    if (this.weatherLayer == null) {
      this.weatherLayer = newWeatherLayer;
      this.map.addLayer(newWeatherLayer);
      return;
    }

    let startIn;
    let startOut;

    const stepFadeIn = (timestamp) => {
      if (startIn === undefined) {
        startIn = timestamp;
      }
      const elapsed = timestamp - startIn;

      newWeatherLayer.setOpacity(elapsed/500);

      if (elapsed < 500) { // Stop the animation after 2 seconds
        window.requestAnimationFrame(stepFadeIn);
      }
    };
    const oldLayer = this.weatherLayer;
    const stepFadeOut = (timestamp) => {
      if (startIn === undefined) {
        startIn = timestamp;
      }
      const elapsed = timestamp - startIn;

      oldLayer.setOpacity(1.0 - elapsed/700);

      if (elapsed < 700) { // Stop the animation after 2 seconds
        window.requestAnimationFrame(stepFadeOut);
      } else {
        this.map.removeLayer(oldLayer);
      }
    };

      //window.requestAnimationFrame(stepFadeOut);
      //newWeatherLayer.setOpacity(0);
      //this.map.addLayer(newWeatherLayer);
      //window.requestAnimationFrame(stepFadeIn);
      //this.weatherLayer = newWeatherLayer;
    if (this.map != null) {
      this.weatherLayer.getLayers().forEach(layer => layer.getSource().setUrl((newWeatherSource.getUrls()[0])));
    }
  }

  setTarget(target) {
    this.map.setTarget(target);
    capDescription.set(
      "Temperature at 2m above ground from the ICON weather model.",
    );
    capLastUpdated.set(null);
  }

  setMap(map) {
    window.weatherSliderChanged = (val) => {this.onSliderChange((val))};
    this.map = map;
    if (this.weatherLayer != null) map.addLayer(this.weatherLayer);
  }
}
