import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type VectorSource from "ol/source/Vector";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions, RadarSocket } from "./options";
import Capability from "./Capability";
import StrikeManagerV2 from "../lib/StrikeManagerV2";
import { capDescription, capLastUpdated, showForecastPlaybutton } from "../stores";
import { lightningLayerDumb, lightningLayerGL } from "../layers/lightning";
import { fetchLightningLayer, fetchLightningSince } from "../api";
import { noaaBREF } from "../layers/noaa";

/**
 * The API's lightning_baseline_max_hours, which defaults to one hour, less a
 * margin: the server compares against its own clock, so a baseline sitting
 * exactly on the limit is already past it by the time the request lands.
 */
const BASELINE_MAX_SECONDS = 60 * 60 - 120;

export default class LightningCapability extends Capability {
  /** The current vector tile layer, replaced whenever a new tile set lands. */
  currentLayer: BaseLayer | null;

  /** The source for strikes newer than the tile set, drawn client-side. */
  vectorsource: VectorSource | null = null;

  sm: StrikeManagerV2 | null = null;

  private nb?: NanobarWrapper;

  private socketio?: RadarSocket;

  /** Kept so destroy() can take the handler back off the socket again. */
  private lightningHandler: ((data: { lon: number; lat: number; time: number }) => void) | null = null;

  constructor(map: Map, additionalLayers: BaseLayer[], args: CapabilityOptions) {
    super(map, "lightning", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchLightning();
    }, additionalLayers);

    if (args.cmap) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;
    this.socketio = args.socket;

    map.addLayer(noaaBREF());
  }

  async fetchLightning() {
    const data = await fetchLightningLayer(this.nb).catch(() => null);
    if (!data) return;
    if (this.currentLayer && this.currentLayer.get("tile_id") === data.tile_id) return;

    const newLayer = lightningLayerGL(data.tile_id);
    newLayer.set("tile_id", data.tile_id);
    super.getMap().addLayer(newLayer);
    if (this.currentLayer) {
      super.getMap().removeLayer(this.currentLayer);
    }
    this.currentLayer = newLayer;
    capLastUpdated.set(new Date(data.processed_time * 1000));

    this.fetchRemaining(data.most_recent_strike);
  }

  async fetchRemaining(baseline: number) {
    // The server rejects a baseline further back than its own window
    // (lightning_baseline_max_hours, one hour by default) with a 400. The tile
    // set's most recent strike is easily older than that when lightning is
    // quiet, so clamp rather than ask for something that cannot be served.
    const oldest = Math.floor(Date.now() / 1000) - BASELINE_MAX_SECONDS;
    const requested = Math.max(baseline, oldest);

    if (!this.sm) {
      const newLayer = lightningLayerDumb();
      super.getMap().addLayer(newLayer);
      const source = newLayer.getSource()!;
      this.vectorsource = source;
      const sm = new StrikeManagerV2(source, requested);
      this.sm = sm;
      // Strikes newer than the published tile set arrive here; the tile set
      // itself covers everything older than the baseline.
      this.lightningHandler = (data) => sm.addStrike(data.lon, data.lat, data.time / 10e5);
      this.socketio?.on("lightning", this.lightningHandler);
    }
    this.sm.setBaseline(requested);

    const data = await fetchLightningSince(requested, this.nb).catch(() => null);
    if (!data) return;
    data.strikes.forEach((elem) => this.sm!.addStrike(elem.lon, elem.lat, elem.time_wall));
  }

  destroy() {
    if (this.socketio && this.lightningHandler) {
      this.socketio.off("lightning", this.lightningHandler);
      this.lightningHandler = null;
    }
  }
}
