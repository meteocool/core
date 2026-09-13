import Capability from "./Capability";
import StrikeManagerV2 from "../lib/StrikeManagerV2";
import { capDescription, capLastUpdated, showForecastPlaybutton } from "../stores";
import { lightningLayerDumb, lightningLayerGL } from "../layers/lightning";
import { fetchLightningLayer, fetchLightningSince } from "../api";
import { noaaBREF } from "../layers/noaa";

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
    this.socketio = args.socket;

    map.addLayer(noaaBREF());
  }

  async fetchLightning() {
    const data = await fetchLightningLayer(this.nb).catch(() => null);
    if (!data) return;
    if (this.currentLayer && this.currentLayer.get("tile_id") === data.tile_id) return;

    const newLayer = lightningLayerGL(data.tile_id, super.getMap());
    newLayer.set("tile_id", data.tile_id);
    super.getMap().addLayer(newLayer);
    if (this.currentLayer) {
      super.getMap().removeLayer(this.currentLayer);
    }
    this.currentLayer = newLayer;
    capLastUpdated.set(new Date(data.processed_time * 1000));

    this.fetchRemaining(data.most_recent_strike);
  }

  async fetchRemaining(baseline) {
    if (!this.vectorsource) {
      const newLayer = lightningLayerDumb();
      super.getMap().addLayer(newLayer);
      this.vectorsource = newLayer.getSource();
      this.sm = new StrikeManagerV2(this.vectorsource, baseline);
      if (this.socketio) {
        this.socketio.on("lightning", (data) => this.sm.addStrike(data.lon, data.lat, data.time / 10e5));
      }
    }
    this.sm.setBaseline(baseline);

    const data = await fetchLightningSince(baseline, this.nb).catch(() => null);
    if (!data) return;
    data.strikes.forEach((elem) => this.sm.addStrike(elem.lon, elem.lat, elem.time_wall));
  }
}
