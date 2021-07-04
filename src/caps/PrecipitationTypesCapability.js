// eslint-disable-next-line import/prefer-default-export
import { capDescription, showForecastPlaybutton } from "../stores";
import Capability from "./Capability";
import { apiBaseUrl } from "../urls";
import { dwdPrecipTypes } from "../layers/radar";

export default class PrecipitationTypesCapability extends Capability {
  constructor(args) {
    super((map) => {
      const additionalLayers = args.additionalLayers || [];
      additionalLayers.forEach((l) => super.getMap().addLayer(l));
    }, () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
    });
    this.currentLayer = null;
    this.nb = args.nanobar;
    this.fetchPrecipTypes();
  }

  fetchPrecipTypes() {
    const URL = `${apiBaseUrl}/precip_types/`;
    this.nb.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((data) => {
        const newLayer = dwdPrecipTypes(data.tile_id);
        super.getMap().addLayer(newLayer);
        if (this.currentLayer) {
          super.getMap().removeLayer(this.currentLayer);
        }
        this.currentLayer = newLayer;
      })
      .then(() => this.nb.finish(URL))
      .catch((error) => {
        this.nb.finish(URL);
        console.log(error);
      });
  }
}
