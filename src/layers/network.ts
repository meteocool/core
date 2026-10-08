import ValueTileSource, { staleOnlyWhileLoading } from "./valueTiles";
import LatestFrame from "./latestFrame";
import { hasTile } from "../lib/tileIndex";
import TileLayer from "./webglTile";
import { createEmpty, extend, getIntersection, isEmpty } from "ol/extent";
import type { Map } from "ol";
import type { Extent } from "ol/extent";
import {
  chmiAttribution, dwdAttribution, imgwAttribution, meteoFranceAttribution, meteoSwissAttribution,
} from "./attributions";
import {
  chExclusiveCoverage,
  chRadarExtent,
  dwdRadarExtent,
  czExclusiveCoverage,
  czRadarExtent,
  frExclusiveCoverage,
  frRadarExtent,
  plExclusiveCoverage,
  plRadarExtent,
} from "./extents";
import { tileSourceUrl } from "./dwd";
import { maskPath } from "./tileMask";
import { drawnTileId, rvp6Style } from "../lib/rvp6";
import { trackTileLoads } from "../lib/tileStatus";
import { NOWCAST_OPACITY } from "./ui";
import {
  fetchCzechRadar, fetchEuropeColumnMaximum, fetchEuropeRadar, fetchFrenchRadar, fetchPolishRadar, fetchSwissRadar,
} from "../api";
import type { Progress, RadarFrame } from "../api";
import type { NetworkCode } from "./networkHoles";

/** One EUMETNET network, as the map draws it. */
export interface Network {
  /** What the backend files it under: the socket event's `network`, the `reflectivity_{code}` collection. */
  code: NetworkCode;
  fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>;
  attribution: string;
  /** The composite grid's rectangle: a cheap first cut, not the coverage claim. */
  extent: Extent;
  /** Where this network may draw; see `extents.ts` for who draws where. Null draws everywhere. */
  coverage: number[][][] | null;
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
 * Every network's lowest tilts on one grid, DWD's included: the merged
 * composite worker-analysis builds on its background worker. Not one of
 * `NETWORKS`: it is not cut to a country and it stands in for all five
 * products at once, on the live step, when the reader asks for it.
 */
export const EUROPE: Network = {
  code: "eu",
  fetch: fetchEuropeRadar,
  attribution: [dwdAttribution, meteoSwissAttribution, meteoFranceAttribution, chmiAttribution, imgwAttribution].join(" "),
  extent: [dwdRadarExtent, chRadarExtent, frRadarExtent, czRadarExtent, plRadarExtent].reduce(
    (whole, one) => extend(whole, one), createEmpty(),
  ),
  coverage: null,
};

/**
 * The column maximum of every network, on the merged composite's kind of
 * grid: every tilt of every radar rather than the lowest (ng ADR 0019). Drawn
 * like `EUROPE`, whole and in place of the others, when the reader asks.
 */
export const EUROPE_COLUMN_MAXIMUM: Network = {
  ...EUROPE,
  code: "colmax",
  fetch: fetchEuropeColumnMaximum,
};

/**
 * The column maximum of every network, cut to the ground the networks draw
 * on: what surrounds DMAX, Germany's own column maximum, in place of the
 * networks' lowest scans. Each network's coverage is one polygon wound to
 * nest and the four only touch, so their rings traced as one path are their
 * union. Its frames are handed to it (`show`), never fetched: they are the
 * whole column maximum's.
 */
export const AROUND_DMAX: Network = {
  ...EUROPE_COLUMN_MAXIMUM,
  extent: NETWORKS.map((network) => network.extent).reduce((whole, one) => extend(whole, one), createEmpty()),
  coverage: NETWORKS.flatMap((network) => network.coverage ?? []),
};

/**
 * An independent tile layer for one EUMETNET network's composite.
 *
 * Two frames, from two places. The live frame is its own: fetched here and
 * replaced whenever a radar reports, on the network's own socket event, which
 * lands every minute or two, far more often than DWD's grid is refetched.
 * Every other past step shows the composite the grid carries for it
 * (`RadarFrames.networks`), which `RadarCapability` hands over as the
 * scrubber moves. The networks have no forecast, so on a forecast step this
 * is hidden and DWD is the radar: see `show`.
 */
export default class NetworkRadarLayer {
  readonly network: Network;

  private readonly map: Map;

  private layer: TileLayer | null = null;

  /** The URL the layer's source is on, so an unchanged step costs nothing. */
  private url = "";

  private live = true;

  /** The newest composite, from `refresh`. */
  private readonly latest: LatestFrame;

  /** This network's composite for the step on screen, when that is not the live one. */
  private stepFrame: RadarFrame | null = null;

  /** Told after every new live frame; the 3D map drapes the same one. */
  private readonly onLiveFrame: (() => void) | undefined;

  /** The palette the reader chose: the layer's style, so a change reloads nothing. */
  private palette = "classic";

  /** How strongly it is drawn: the radar map's own, unless a map lays it under something else. */
  private readonly opacity: number;

  constructor(map: Map, network: Network, onLiveFrame?: () => void, opacity = NOWCAST_OPACITY) {
    this.map = map;
    this.network = network;
    this.latest = new LatestFrame(network.fetch);
    this.onLiveFrame = onLiveFrame;
    this.opacity = opacity;
  }

  /** Fetch the newest composite and show it, creating the layer on first use. */
  async refresh(nanobar?: Progress) {
    const frame = await this.latest.refresh(nanobar);
    if (!frame) return; // nothing composited yet, or the request failed

    this.apply();
    this.onLiveFrame?.();
  }

  /**
   * The newest composite, if it is still worth drawing: what the live step
   * shows, and what the 3D map drapes. Judged against now rather than at
   * `refresh`, so a frame left to age on a map nobody touched is not handed
   * on as current.
   */
  current(): RadarFrame | null {
    return this.latest.current();
  }

  /** Whether the backend has answered for this product yet, with a frame or with none. */
  answered(): boolean {
    return this.latest.answered;
  }

  /**
   * What the map is showing: the live frame, or another step and this
   * network's composite for it (null when the grid has none, which is every
   * forecast step and any gap in the network's ingest).
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

  /** Draw this network in a palette from now on. */
  setPalette(palette: string) {
    this.palette = palette;
    this.layer?.setStyle(rvp6Style(palette));
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
      const template = tileSourceUrl("meteoradar", drawnTileId(frame));
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
    const frame = this.live ? this.latest.current() : this.stepFrame;
    if (!frame) {
      this.layer?.setVisible(false);
      return;
    }
    const url = tileSourceUrl("meteoradar", drawnTileId(frame));
    if (!this.layer) {
      this.createLayer(url, frame);
    } else if (url !== this.url) {
      (this.layer.getSource() as ValueTileSource | null)?.setUrl(url, frame.tiles);
    }
    this.url = url;
    this.layer!.setVisible(true);
  }

  /**
   * The layer, drawn only over the ground `extents.ts` gives this network.
   *
   * Every network colours dBZ on its own scale and every palette is part
   * transparent, so wherever two are drawn over each other the result is a
   * blend that reads as a third intensity neither measured. So each tile is
   * cut to `coverage` as it loads (`valueTiles.ts`), which keeps exactly one
   * network's colours on any pixel; the holes cut into DWD's tiles
   * (`networkHoles.ts`) are the other half. A WebGL layer cannot be clipped
   * at render time, and nothing outside the coverage is even fetched.
   */
  private createLayer(url: string, frame: RadarFrame) {
    const source = trackTileLoads(new ValueTileSource({
      url,
      index: frame.tiles,
      keep: this.network.coverage ? maskPath(this.network.coverage) : null,
      attributions: [this.network.attribution],
      minZoom: 3,
      maxZoom: 8,
      tileSize: 512,
      transition: 0,
      interpolate: false,
    }));
    this.layer = staleOnlyWhileLoading(new TileLayer({
      source,
      style: rvp6Style(this.palette),
      // Just under DWD's 80. The cut means they never cover the same pixel,
      // so this only settles which draws first. Europe's draws above DWD's
      // instead, which is hidden while it shows.
      zIndex: this.network.coverage ? 79 : 81,
      opacity: this.opacity,
      cacheSize: 512,
      // The rectangle is a cheap first pass; `coverage` is the real edge.
      extent: this.network.extent,
    }));
    this.map.addLayer(this.layer);
  }

  destroy() {
    if (this.layer) {
      this.map.removeLayer(this.layer);
      this.layer = null;
    }
  }
}
