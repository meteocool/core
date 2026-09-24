import ImageTileSource from "ol/source/ImageTile";
import TileLayer from "ol/layer/Tile";
import { getRenderPixel } from "ol/render";
import type { Map } from "ol";
import type { Extent } from "ol/extent";
import type RenderEvent from "ol/render/Event";
import { chmiAttribution, meteoFranceAttribution, meteoSwissAttribution } from "./attributions";
import {
  chExclusiveCoverage,
  chRadarExtent,
  czExclusiveCoverage,
  czRadarExtent,
  frExclusiveCoverage,
  frRadarExtent,
} from "./extents";
import { tileSourceUrl } from "./dwd";
import { trackTileLoads } from "../lib/tileStatus";
import { NOWCAST_OPACITY } from "./ui";
import { fetchCzechRadar, fetchFrenchRadar, fetchSwissRadar } from "../api";
import type { Progress, RadarFrame } from "../api";
import type { NetworkEvent } from "../api/events";

/** One EUMETNET network, as the map draws it. */
export interface Network {
  /** What the backend files it under: the socket event's `network`, the `reflectivity_{code}` collection. */
  code: NetworkEvent["network"];
  fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>;
  attribution: string;
  /** The composite grid's rectangle: a cheap first cut, not the coverage claim. */
  extent: Extent;
  /** Where this network may draw; see `extents.ts` for who draws where. */
  coverage: number[][][];
}

export const SWITZERLAND: Network = {
  code: "ch",
  fetch: fetchSwissRadar,
  attribution: meteoSwissAttribution,
  extent: chRadarExtent,
  coverage: chExclusiveCoverage,
};

export const FRANCE: Network = {
  code: "fr",
  fetch: fetchFrenchRadar,
  attribution: meteoFranceAttribution,
  extent: frRadarExtent,
  coverage: frExclusiveCoverage,
};

export const CZECHIA: Network = {
  code: "cz",
  fetch: fetchCzechRadar,
  attribution: chmiAttribution,
  extent: czRadarExtent,
  coverage: czExclusiveCoverage,
};

export const NETWORKS: Network[] = [SWITZERLAND, FRANCE, CZECHIA];

/**
 * A frame older than this is not shown. The backend publishes whenever a radar
 * reports, every few minutes; a frame this old means the ingest has stopped,
 * and old weather drawn as the live frame is worse than none.
 */
const STALE_AFTER_SECONDS = 30 * 60;

/**
 * An independent tile layer for one EUMETNET network's composite.
 *
 * Deliberately not part of `RadarCapability`'s DWD grid/`GridStep` scrubbing:
 * these networks have no timesteps to scrub through, just one composite
 * replaced whenever a radar reports, so the layers share only the tile-URL
 * format (`tileSourceUrl`, the same one DWD's layer builds from) and the map
 * they render onto.
 *
 * Shown only on the live frame: see `setLive`.
 */
export default class NetworkRadarLayer {
  readonly network: Network;

  private readonly map: Map;

  private layer: TileLayer<ImageTileSource> | null = null;

  private live = true;

  private fresh = false;

  constructor(map: Map, network: Network) {
    this.map = map;
    this.network = network;
  }

  /** Fetch the newest composite and show it, creating the layer on first use. */
  async refresh(nanobar?: Progress) {
    const frame = await this.network.fetch(nanobar).catch(() => null);
    if (!frame) return; // nothing composited yet, or the request failed

    this.fresh = Date.now() / 1000 - frame.processed_time < STALE_AFTER_SECONDS;
    const url = tileSourceUrl("meteoradar", frame.tile_id);
    if (this.layer) {
      (this.layer.getSource() as ImageTileSource | null)?.setUrl(url);
      this.applyVisibility();
      return;
    }

    const source = trackTileLoads(new ImageTileSource({
      attributions: [this.network.attribution],
      crossOrigin: "anonymous",
      minZoom: 3,
      maxZoom: 8,
      tileSize: 512,
      transition: 0,
      interpolate: false,
      url,
    }));
    this.layer = new TileLayer({
      source,
      // Just under DWD's 80. The clip below means they never cover the same
      // pixel, so this only settles which draws first.
      zIndex: 79,
      opacity: NOWCAST_OPACITY,
      cacheSize: 512,
      // The rectangle is a cheap first pass; `coverage` is the real edge, and
      // an extent cannot describe it because it is not a rectangle.
      extent: this.network.extent,
    });
    this.clipToExclusiveCoverage(this.layer);
    this.applyVisibility();
    this.map.addLayer(this.layer);
  }

  /**
   * Whether the map is showing the live frame.
   *
   * This layer is one frame, the newest: it has no history and no forecast.
   * Drawn under any other step it would put now's weather beside an hour-ago
   * label -- or over DWD's forecast, blending the two -- so it steps aside and
   * DWD, whole again (see `networkHoles.ts`), is the radar for that step.
   */
  setLive(live: boolean) {
    this.live = live;
    this.applyVisibility();
  }

  private applyVisibility() {
    this.layer?.setVisible(this.live && this.fresh);
  }

  /**
   * Draw this layer only over the ground `extents.ts` gives this network.
   *
   * A canvas clip rather than opacity or a z-order: every network colours dBZ
   * on its own scale, and every palette is part transparent, so wherever two
   * of them are drawn over each other the result is a blend that reads as a
   * third intensity that neither measured. Clipping keeps exactly one
   * network's colours on any given pixel -- with the other half of that
   * bargain in `networkHoles.ts`, which takes these countries out of DWD's tiles.
   *
   * This is why the layer is an `ol/layer/Tile` and not the `WebGLTile` its
   * DWD counterpart uses: the clip is a `CanvasRenderingContext2D` path, and
   * a WebGL layer's render events hand out no such context.
   */
  private clipToExclusiveCoverage(layer: TileLayer<ImageTileSource>) {
    layer.on("prerender", (event: RenderEvent) => {
      const context = event.context as CanvasRenderingContext2D | undefined;
      if (!context) return;
      context.save();
      context.beginPath();
      for (const ring of this.network.coverage) {
        ring.forEach((coordinate, index) => {
          const [x, y] = getRenderPixel(event, this.map.getPixelFromCoordinate(coordinate));
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
      }
      context.clip();
    });
    // Paired with the save() above; without it the clip leaks onto whatever
    // the map draws next.
    layer.on("postrender", (event: RenderEvent) => {
      (event.context as CanvasRenderingContext2D | undefined)?.restore();
    });
  }

  destroy() {
    if (this.layer) {
      this.map.removeLayer(this.layer);
      this.layer = null;
    }
  }
}
