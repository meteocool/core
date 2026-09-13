// eslint-disable-next-line import/prefer-default-export
import { s5pAerosolIndex354 } from "../layers/satellite";
import {
  capDescription,
  showForecastPlaybutton,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type TileLayer from "ol/layer/WebGLTile";
import Capability from "./Capability";

const AEROSOLS_DESCRIPTION_LONG = `UVAI`;

export default class AerosolsCapability extends Capability {
  /** The Sentinel-5P UV aerosol index layer. */
  ai354: TileLayer;

  constructor(map: Map, additionalLayers: BaseLayer[]) {
    super(map, "aerosols", () => {
      capDescription.set(AEROSOLS_DESCRIPTION_LONG);
      showForecastPlaybutton.set(false);
    }, additionalLayers);

    this.ai354 = s5pAerosolIndex354();
    map.addLayer(this.ai354);
  }
}
