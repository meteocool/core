// eslint-disable-next-line import/prefer-default-export
import { s5pAerosolIndex354 } from "../layers/satellite";
import {
  capDescription,
  showForecastPlaybutton,
} from "../stores";
import Capability from "./Capability.ts";

const AEROSOLS_DESCRIPTION_LONG = `UVAI`;

export default class AerosolsCapability extends Capability {
  constructor(map, additionalLayers) {
    super(map, "aerosols", () => {
      capDescription.set(AEROSOLS_DESCRIPTION_LONG);
      showForecastPlaybutton.set(false);
    }, additionalLayers);

    this.ai354 = s5pAerosolIndex354();
    map.addLayer(this.ai354);
  }
}
