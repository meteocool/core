// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, showForecastPlaybutton } from '../stores';
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions } from "./options";
import Capability from "./Capability";
import { fetchPrecipitationTypes } from "../api";
import { dwdPrecipTypes } from "../layers/dwd";

export default class PrecipitationTypesCapability extends Capability {
  /** The current tile layer, replaced whenever a new tile set lands. */
  currentLayer: BaseLayer | null;

  private nb?: NanobarWrapper;

  constructor(map: Map, additionalLayers: BaseLayer[], args: CapabilityOptions) {
    super(map, "precipTypes", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchPrecipTypes();
    }, additionalLayers);

    if (args.cmap) super.setCmap(args.cmap);

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
