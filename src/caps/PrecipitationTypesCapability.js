// eslint-disable-next-line import/prefer-default-export
import { capDescription, capLastUpdated, sharedCmap, showForecastPlaybutton } from '../stores';
import Capability from "./Capability";
import { apiBaseUrl } from "../urls";
import { dwdPrecipTypes } from "../layers/radar";
import { writable } from 'svelte/store';

export default class PrecipitationTypesCapability extends Capability {
  constructor(args) {
    super((map) => {
      const additionalLayers = args.additionalLayers || [];
      additionalLayers.forEach((l) => map.addLayer(l));
    }, () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchPrecipTypes();
    });

    if ("cmap" in args) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;
  }

  fetchPrecipTypes() {
    const URL = `${apiBaseUrl}/precip_types/`;
    this.nb.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((data) => {
        if (!data) return;
        if (this.currentLayer) {
          if (this.currentLayer.get("tile_id") === data.tile_id) return;
        }
        const newLayer = dwdPrecipTypes(data.tile_id);
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
