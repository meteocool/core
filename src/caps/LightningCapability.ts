import type { Map } from "ol";
import { Feature } from "ol";
import Point from "ol/geom/Point";
import type VectorLayer from "ol/layer/Vector";
import { derived, get } from "svelte/store";
import type BaseLayer from "ol/layer/Base";
import type VectorSource from "ol/source/Vector";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions, RadarSocket } from "./options";
import Capability from "./Capability";
import StrikeManagerV2 from "../lib/StrikeManagerV2";
import { LIVE_STRIKE_BATCH_MS } from "../lib/StrikeManager";
import { coalesce, type Coalescer } from "../lib/coalesce";
import {
  archiveWindow, capDescription, capLastUpdated, capTimeIndicator, radarColorScheme, sharedActiveCap,
  showForecastPlaybutton,
} from "../stores";
import { lightningLayerDumb, lightningLayerGL } from "../layers/lightning";
import { TIME_KEY } from "../lib/StrikeManagerV2";
import { archiveStrikes } from "../lib/ArchiveStrikes";
import type { ArchiveWindow } from "../lib/archive";
import { fetchLightningLayer, fetchLightningSince } from "../api";
import { noaaBREF } from "../layers/noaa";
import NetworkRadarLayer, { EUROPE } from "../layers/network";
import { whenVisible } from "../lib/wakeup";
import type { NetworkEvent } from "../api/events";

/**
 * The API's lightning_baseline_max_hours, which defaults to one hour, less a
 * margin: the server compares against its own clock, so a baseline sitting
 * exactly on the limit is already past it by the time the request lands.
 */
const BASELINE_MAX_SECONDS = 60 * 60 - 120;

/**
 * Opacity of the rain under the strikes: strong enough to show which storm
 * each strike belongs to, faint enough to keep the strikes in front.
 */
const RAIN_UNDERLAY_OPACITY = 0.3;

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

  /** Live strikes waiting to be added together; see lib/coalesce.ts. */
  private liveStrikes: Coalescer<{ lon: number; lat: number; time: number }> | null = null;

  /**
   * The merged European composite, drawn faintly under the strikes so each
   * strike shows up inside its storm. Only the newest frame, as the radar
   * map's live step draws it, in the reader's palette.
   */
  private readonly rain: NetworkRadarLayer;

  private networkHandler: ((event: NetworkEvent) => void) | null = null;

  private unsubscribePalette: (() => void) | null = null;

  /**
   * In a past window (lib/archive.ts), its strikes as features: the half
   * hour up to the step on screen, aged against it, in place of the newest
   * tile set and the live strikes, which are hidden while it is open.
   */
  private archiveLayer: VectorLayer | null = null;

  private past: ArchiveWindow | null = null;

  private unsubscribeWindow: (() => void) | null = null;

  constructor(map: Map, additionalLayers: BaseLayer[], args: CapabilityOptions) {
    super(map, "lightning", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      if (this.past) return;
      this.fetchLightning();
      void this.rain.refresh(this.nb);
    }, additionalLayers);

    if (args.cmap) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;
    this.socketio = args.socket;

    map.addLayer(noaaBREF());

    this.rain = new NetworkRadarLayer(map, EUROPE, undefined, RAIN_UNDERLAY_OPACITY);
    this.unsubscribePalette = radarColorScheme.subscribe((palette) => this.rain.setPalette(palette));
    // A new merged frame every few minutes, announced like any network's.
    this.networkHandler = ({ network }) => {
      if (network !== EUROPE.code || this.past) return;
      whenVisible("lightning:network:eu", () => { void this.rain.refresh(this.nb); });
    };
    this.socketio?.on("network", this.networkHandler);

    this.unsubscribeWindow = derived([archiveWindow, capTimeIndicator], (values) => values)
      .subscribe(([past, shown]) => this.showWindow(past, shown));
  }

  /** Into a past window, out of one, or another step of it. */
  private showWindow(past: ArchiveWindow | null, shown: number) {
    const was = this.past;
    this.past = past;
    const live = past === null;
    this.currentLayer?.setVisible(live);
    if (this.vectorsource) for (const layer of super.getMap().getAllLayers()) {
      if (layer.getSource() === this.vectorsource) layer.setVisible(live);
    }
    // The merged composite under the strikes is the newest frame's, which a past window does not have.
    this.rain.show(live, null);
    if (live) {
      this.archiveLayer?.getSource()?.clear();
      this.archiveLayer?.setVisible(false);
      // On screen, the newest at once; otherwise when switched to.
      if (was && get(sharedActiveCap) === "lightning") {
        void this.fetchLightning(true);
        void this.rain.refresh(this.nb);
      }
      return;
    }
    if (!this.archiveLayer) {
      this.archiveLayer = lightningLayerDumb();
      super.getMap().addLayer(this.archiveLayer);
    }
    this.archiveLayer.setVisible(true);
    void this.drawArchived(shown || past.end);
  }

  private async drawArchived(shown: number) {
    const strikes = await archiveStrikes.at(shown);
    if (!strikes || !this.past || (get(capTimeIndicator) || this.past.end) !== shown) return;
    const source = this.archiveLayer?.getSource();
    if (!source) return;
    source.clear(true);
    source.addFeatures(strikes.map((strike) => {
      const feature = new Feature(new Point([strike.lon, strike.lat]));
      feature.set(TIME_KEY, strike.time_wall);
      return feature;
    }));
  }

  /**
   * Without this it only fetches when shown, so a failed first fetch left the
   * map without strikes until the reader switched away and back. That included
   * the socket's live strikes, which only start after the first success.
   */
  resync() {
    if (this.past) {
      void this.drawArchived(get(capTimeIndicator) || this.past.end);
      return;
    }
    void this.fetchLightning(true);
    void this.rain.refresh(this.nb);
  }

  /** `backfill`: the tile set may be unchanged, but strikes since it may have been missed. */
  async fetchLightning(backfill = false) {
    const data = await fetchLightningLayer(this.nb).catch(() => null);
    if (!data) return;
    if (this.currentLayer && this.currentLayer.get("tile_id") === data.tile_id) {
      if (backfill) void this.fetchRemaining(data.most_recent_strike);
      return;
    }

    const newLayer = lightningLayerGL(data.tile_id);
    newLayer.set("tile_id", data.tile_id);
    newLayer.setVisible(!this.past);
    super.getMap().addLayer(newLayer);
    if (this.currentLayer) {
      super.getMap().removeLayer(this.currentLayer);
      // Removed is not released: its renderer and GPU target stayed.
      this.currentLayer.dispose();
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
      // Batched briefly into one change on the source; see lib/coalesce.ts.
      this.liveStrikes = coalesce<{ lon: number; lat: number; time: number }>(
        (strikes) => sm.addStrikes(strikes.map(({ lon, lat, time }) => ({ lon, lat, timestamp: time / 10e5 }))),
        LIVE_STRIKE_BATCH_MS,
      );
      const liveStrikes = this.liveStrikes;
      this.lightningHandler = (data) => { if (!this.past) liveStrikes.push(data); };
      this.socketio?.on("lightning", this.lightningHandler);
    }
    this.sm.setBaseline(requested);

    const data = await fetchLightningSince(requested, this.nb).catch(() => null);
    if (!data) return;
    this.sm!.addStrikes(data.strikes.map((elem) => ({ lon: elem.lon, lat: elem.lat, timestamp: elem.time_wall })));
  }

  destroy() {
    this.unsubscribeWindow?.();
    this.unsubscribeWindow = null;
    if (this.socketio && this.lightningHandler) {
      this.socketio.off("lightning", this.lightningHandler);
      this.lightningHandler = null;
    }
    this.liveStrikes?.cancel();
    this.liveStrikes = null;
    if (this.socketio && this.networkHandler) {
      this.socketio.off("network", this.networkHandler);
      this.networkHandler = null;
    }
    this.unsubscribePalette?.();
    this.unsubscribePalette = null;
    this.rain.destroy();
  }
}
