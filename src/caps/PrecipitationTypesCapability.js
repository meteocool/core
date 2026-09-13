// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, showForecastPlaybutton } from '../stores';
import Capability from "./Capability";
import { fetchPrecipitationTypes } from "../api";
import { dwdPrecipTypes } from "../layers/dwd.js";

export default class PrecipitationTypesCapability extends Capability {
  constructor(map, additionalLayers, args) {
    super(map, "precipTypes", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchPrecipTypes();
    }, additionalLayers);

    if ("cmap" in args) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;
  }

  async fetchPrecipTypes() {
    const data = await fetchPrecipitationTypes(this.nb).catch(() => null);
    if (!data) return;
    if (this.currentLayer && this.currentLayer.get("tile_id") === data.tile_id) return;

    const newLayer = dwdPrecipTypes(data.tile_id);
    newLayer.set("tile_id", data.tile_id);
    super.getMap().addLayer(newLayer);
    if (this.currentLayer) {
      super.getMap().removeLayer(this.currentLayer);
    }
    this.currentLayer = newLayer;
    capLastUpdated.set(new Date(data.processed_time * 1000));
  }
}
