// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, showForecastPlaybutton } from "../stores";
import Capability from "./Capability.ts";
import { apiBaseUrl, v3APIBaseUrl } from "../urls";
import { dwdPrecipTypes } from "../layers/radar";
import { lightningLayerGL } from '../layers/lightning';

export default class LightningCapability extends Capability {
  constructor(map, additionalLayers, args) {
    super(map, "lightning", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchLightning();
    }, additionalLayers);

    if ("cmap" in args) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;
  }

  fetchLightning() {
    const URL = `${v3APIBaseUrl}/lightning/layer`;
    this.nb.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((data) => {
        if (!data) return;
        if (this.currentLayer) {
          if (this.currentLayer.get("tile_id") === data.tile_id) return;
        }
        const newLayer = lightningLayerGL(data.tile_id, super.getMap());
        newLayer.set("tile_id", data.tile_id);
        super.getMap().addLayer(newLayer);
        if (this.currentLayer) {
          super.getMap().removeLayer(this.currentLayer);
        }
        this.currentLayer = newLayer;
        capLastUpdated.set(new Date(data.processed_time * 1000));
      })
      .then(() => this.nb.finish(URL))
      .catch((error) => {
        this.nb.finish(URL);
        console.log(error);
      });
  }
}
