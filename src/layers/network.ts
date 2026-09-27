import IndexedTileSource from "./indexedTiles";
import { hasTile } from "../lib/tileIndex";
import TileLayer from "ol/layer/Tile";
import { getRenderPixel } from "ol/render";
import { getIntersection, isEmpty } from "ol/extent";
import type { Map } from "ol";
import type { Extent } from "ol/extent";
import type RenderEvent from "ol/render/Event";
import { chmiAttribution, imgwAttribution, meteoFranceAttribution, meteoSwissAttribution } from "./attributions";
import {
  chExclusiveCoverage,
  chRadarExtent,
  czExclusiveCoverage,
  czRadarExtent,
  frExclusiveCoverage,
  frRadarExtent,
  plExclusiveCoverage,
  plRadarExtent,
} from "./extents";
import { tileSourceUrl } from "./dwd";
import { trackTileLoads } from "../lib/tileStatus";
import { NOWCAST_OPACITY } from "./ui";
import { fetchCzechRadar, fetchFrenchRadar, fetchPolishRadar, fetchSwissRadar } from "../api";
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

export const POLAND: Network = {
  code: "pl",
  fetch: fetchPolishRadar,
  attribution: imgwAttribution,
  extent: plRadarExtent,
  coverage: plExclusiveCoverage,
};

export const NETWORKS: Network[] = [SWITZERLAND, FRANCE, CZECHIA, POLAND];

/**
 * A frame older than this is not shown. The backend publishes whenever a radar
 * reports, every few minutes; a frame this old means the ingest has stopped,
 * and old weather drawn as the live frame is worse than none.
 */
const STALE_AFTER_SECONDS = 30 * 60;

/**
 * An independent tile layer for one EUMETNET network's composite.
 *
 * Two frames, from two places. The live frame is its own: fetched here and
 * replaced whenever a radar reports, on the network's own socket event, which
 * lands every minute or two -- far more often than DWD's grid is refetched.
 * Every other past step shows the composite the grid carries for it
 * (`RadarFrames.networks`), which `RadarCapability` hands over as the
 * scrubber moves. The networks have no forecast, so on a forecast step this
 * is hidden and DWD is the radar: see `show`.
 */
export default class NetworkRadarLayer {
  readonly network: Network;

  private readonly map: Map;

  private layer: TileLayer<IndexedTileSource> | null = null;

  /** The URL the layer's source is on, so an unchanged step costs nothing. */
  private url = "";

  private live = true;

  private fresh = false;

  /** The newest composite, from `refresh`. */
  private liveFrame: RadarFrame | null = null;

  /** This network's composite for the step on screen, when that is not the live one. */
  private stepFrame: RadarFrame | null = null;

  constructor(map: Map, network: Network) {
    this.map = map;
    this.network = network;
  }

  /** Fetch the newest composite and show it, creating the layer on first use. */
  async refresh(nanobar?: Progress) {
    const frame = await this.network.fetch(nanobar).catch(() => null);
    if (!frame) return; // nothing composited yet, or the request failed

    this.fresh = Date.now() / 1000 - frame.processed_time < STALE_AFTER_SECONDS;
    this.liveFrame = frame;
    this.apply();
  }

  /**
   * What the map is showing: the live frame, or another step and this
   * network's composite for it -- null when the grid has none, which is every
   * forecast step and any gap in the network's ingest.
   *
   * Without one the layer steps aside and DWD, whole on that step (see
   * `networkHoles.ts`), is the radar there. Drawing the nearest frame instead
   * would put now's weather beside an hour-ago label, or over DWD's forecast,
   * blending the two.
   */
  show(live: boolean, frame: RadarFrame | null) {
    this.live = live;
    this.stepFrame = frame;
    this.apply();
  }

  /**
   * The tile URLs to ask for ahead of playback, for these frames where the
   * map is looking. Empty until the layer exists, which it does from the
   * first composite on.
   */
  tileUrls(frames: RadarFrame[], max: number): string[] {
    const source = this.layer?.getSource();
    const view = this.map.getView();
    const size = this.map.getSize();
    const resolution = view.getResolution();
    if (!source || !size || resolution === undefined) return [];
    const extent = getIntersection(view.calculateExtent(size), this.network.extent);
    if (isEmpty(extent)) return [];
    const tileGrid = source.getTileGridForProjection(view.getProjection());
    const z = tileGrid.getZForResolution(resolution);

    const urls: string[] = [];
    for (const frame of frames) {
      const template = tileSourceUrl("meteoradar", frame.tile_id);
      tileGrid.forEachTileCoord(extent, z, ([tz, x, y]) => {
        if (urls.length >= max) return;
        // Not a tile the frame does not have: the index is what the loader
        // will consult too, so this is a request that would never be made.
        if (!hasTile(frame.tiles, tz, x, 2 ** tz - 1 - y)) return;
        urls.push(template
          .replace("{z}", String(tz))
          .replace("{x}", String(x))
          .replace("{-y}", String(2 ** tz - 1 - y)));
      });
    }
    return urls;
  }

  private apply() {
    const frame = this.live ? (this.fresh ? this.liveFrame : null) : this.stepFrame;
    if (!frame) {
      this.layer?.setVisible(false);
      return;
    }
    const url = tileSourceUrl("meteoradar", frame.tile_id);
    if (!this.layer) {
      this.createLayer(url, frame.tiles);
    } else if (url !== this.url) {
      (this.layer.getSource() as IndexedTileSource | null)?.setUrl(url, frame.tiles);
    }
    this.url = url;
    this.layer!.setVisible(true);
  }

  private createLayer(url: string, index: RadarFrame["tiles"]) {
    const source = trackTileLoads(new IndexedTileSource({
      index,
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
    this.map.addLayer(this.layer);
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
  private clipToExclusiveCoverage(layer: TileLayer<IndexedTileSource>) {
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
