// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, showForecastPlaybutton } from '../stores';
import { reportError } from "../lib/Toast";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions } from "./options";
import Capability from "./Capability";

const WEATHER_DESCRIPTION = `
Temperature at 2m above ground from the ICON weather model.
`;

/**
 * The ICON 2m-temperature layer.
 *
 * Dead: nothing imports this, no capability descriptor registers it, and the
 * `meteomodels` bucket its tiles come from is not produced by the backend. Its
 * super() call was also missing the name argument, so constructing it would
 * have passed the callback where the name belongs. Kept and typed rather than
 * deleted; the types now say plainly that it does not fit.
 */
export default class WeatherCapability extends Capability {
  private url: string;

  private nanobar: NanobarWrapper;

  weatherLayer: BaseLayer | null;

  iconLayers: unknown[];

  constructor(map: Map, additionalLayers: BaseLayer[], options: CapabilityOptions & { tileURL: string }) {
    super(map, "weather", () => {
      capDescription.set(WEATHER_DESCRIPTION);
      capLastUpdated.set(null);
      showForecastPlaybutton.set(true);
    }, additionalLayers);
    this.url = options.tileURL;
    this.nanobar = options.nanobar!;
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
