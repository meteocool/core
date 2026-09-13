import { get } from "svelte/store";
import { sentinel2, sentinel3 } from "../layers/satellite";
import {
  capDescription,
  satelliteLayer,
  satelliteLayerCloudy, satelliteLayerLabels,
  showForecastPlaybutton,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type TileLayer from "ol/layer/WebGLTile";
import Capability from "./Capability";

const SATELLITE_DESCRIPTION_LONG = `
💡 Sentinel-2 A and B are two ESA satellites 🛰 orbiting
earth at 786km. With their multi-spectral cameras, together
they image almost every place on earth 🌍 once every 5 days.
Their ground-resolution is 10 meters per pixel, which might
seem low. But consider that this data is freely available
within a few hours after recording, continuously for all
of Earth. 🚀`;

export default class SatelliteCapability extends Capability {
  /** Rebuilt whenever the cloud mask is toggled, so it is not readonly. */
  sentinel2: TileLayer;

  sentinel3: TileLayer;

  constructor(map: Map, additionalLayers: BaseLayer[]) {
    super(map, "satellite", () => {
      capDescription.set(SATELLITE_DESCRIPTION_LONG);
      showForecastPlaybutton.set(false);
    }, additionalLayers);

    this.sentinel3 = sentinel3();
    map.addLayer(this.sentinel3);
    this.sentinel2 = sentinel2(false, get(satelliteLayer) === "sentinel2");
    map.addLayer(this.sentinel2);
    satelliteLayerCloudy.subscribe((cloudy) => {
      if (this.sentinel2.get("cloudy") !== cloudy) {
        this.recreateS2(cloudy);
      }
    });
    satelliteLayerLabels.subscribe((vis) => {
      additionalLayers.forEach((layer) => layer.setVisible(vis));
    });
    satelliteLayer.subscribe((layer) => {
      switch (layer) {
        case "sentinel2":
          this.sentinel2.setVisible(true);
          break;
        case "sentinel3":
        default:
          this.sentinel2.setVisible(false);
          break;
      }
    });
  }

  recreateS2(cloudy: boolean) {
    super.getMap().removeLayer(this.sentinel2);
    this.sentinel2 = sentinel2(cloudy, this.sentinel2.getVisible());
    super.getMap().addLayer(this.sentinel2);
  }
}
