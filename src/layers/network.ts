import ValueTileSource from "./valueTiles";
import type { PreviewJob, TileJob } from "./valueTiles";
import LatestFrame from "./latestFrame";
import { radarDrawing } from "./radarDrawing";
import type { RadarDrawing } from "./radarDrawing";
import { compositeDim } from "../stores";
import { createEmpty, extend, getIntersection, isEmpty } from "ol/extent";
import type { Map } from "ol";
import type { Extent } from "ol/extent";
import {
  chmiAttribution, dhmzAttribution, dmiAttribution, dwdAttribution, fmiAttribution, imgwAttribution, kaurAttribution,
  knmiAttribution, lhmtAttribution, meteoFranceAttribution, meteoSwissAttribution, metEireannAttribution,
  metNorwayAttribution, rmiVmmAttribution, shmuAttribution, smhiAttribution,
} from "./attributions";
import {
  beExclusiveCoverage,
  beRadarExtent,
  chExclusiveCoverage,
  chRadarExtent,
  czExclusiveCoverage,
  czRadarExtent,
  dkExclusiveCoverage,
  dkRadarExtent,
  dwdRadarExtent,
  eeExclusiveCoverage,
  eeRadarExtent,
  fiExclusiveCoverage,
  fiRadarExtent,
  frExclusiveCoverage,
  frRadarExtent,
  hrExclusiveCoverage,
  hrRadarExtent,
  ieExclusiveCoverage,
  ieRadarExtent,
  ltExclusiveCoverage,
  ltRadarExtent,
  nlExclusiveCoverage,
  nlRadarExtent,
  noExclusiveCoverage,
  noRadarExtent,
  plExclusiveCoverage,
  plRadarExtent,
  seExclusiveCoverage,
  seRadarExtent,
  skExclusiveCoverage,
  skRadarExtent,
} from "./extents";
import { tileSourceUrl } from "./dwd";
import { maskPath } from "./tileMask";
import { RVP6_ENCODING, drawnTileId, encodingOf } from "../lib/rvp6";
import type { Ink } from "../lib/rvp6";
import { trackTileLoads } from "../lib/tileStatus";
import { NOWCAST_OPACITY } from "./ui";
import {
  fetchBelgianRadar, fetchCroatianRadar, fetchCzechRadar, fetchDanishRadar, fetchDutchRadar, fetchEchoTop18, fetchEchoTop45,
  fetchEchoTop50, fetchEstonianRadar, fetchEuropeColumnMaximum, fetchEuropeRadar, fetchFinnishRadar, fetchFrenchRadar,
  fetchIrishRadar, fetchLithuanianRadar, fetchNorwegianRadar, fetchPolishRadar, fetchSlovakRadar, fetchSwedishRadar,
  fetchSwissRadar, fetchVerticallyIntegratedLiquid,
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
  /** The bucket its frames' tiles are in: `meteoradar` unless said otherwise. */
  bucket?: string;
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

export const BELGIUM: Network = {
  code: "be",
  fetch: fetchBelgianRadar,
  attribution: rmiVmmAttribution,
  extent: beRadarExtent,
  coverage: beExclusiveCoverage,
};

export const SLOVAKIA: Network = {
  code: "sk",
  fetch: fetchSlovakRadar,
  attribution: shmuAttribution,
  extent: skRadarExtent,
  coverage: skExclusiveCoverage,
};

export const LITHUANIA: Network = {
  code: "lt",
  fetch: fetchLithuanianRadar,
  attribution: lhmtAttribution,
  extent: ltRadarExtent,
  coverage: ltExclusiveCoverage,
};

export const ESTONIA: Network = {
  code: "ee",
  fetch: fetchEstonianRadar,
  attribution: kaurAttribution,
  extent: eeRadarExtent,
  coverage: eeExclusiveCoverage,
};

export const IRELAND: Network = {
  code: "ie",
  fetch: fetchIrishRadar,
  attribution: metEireannAttribution,
  extent: ieRadarExtent,
  coverage: ieExclusiveCoverage,
};

export const CROATIA: Network = {
  code: "hr",
  fetch: fetchCroatianRadar,
  attribution: dhmzAttribution,
  extent: hrRadarExtent,
  coverage: hrExclusiveCoverage,
};

export const DENMARK: Network = {
  code: "dk",
  fetch: fetchDanishRadar,
  attribution: dmiAttribution,
  extent: dkRadarExtent,
  coverage: dkExclusiveCoverage,
};

export const NETHERLANDS: Network = {
  code: "nl",
  fetch: fetchDutchRadar,
  attribution: knmiAttribution,
  extent: nlRadarExtent,
  coverage: nlExclusiveCoverage,
};

export const FINLAND: Network = {
  code: "fi",
  fetch: fetchFinnishRadar,
  attribution: fmiAttribution,
  extent: fiRadarExtent,
  coverage: fiExclusiveCoverage,
};

export const SWEDEN: Network = {
  code: "se",
  fetch: fetchSwedishRadar,
  attribution: smhiAttribution,
  extent: seRadarExtent,
  coverage: seExclusiveCoverage,
};

export const NORWAY: Network = {
  code: "no",
  fetch: fetchNorwegianRadar,
  attribution: metNorwayAttribution,
  extent: noRadarExtent,
  coverage: noExclusiveCoverage,
};

/** In the coverage document's priority order (`spec/coverage.json`), after DWD. */
export const NETWORKS: Network[] = [
  SWITZERLAND, FRANCE, CZECHIA, POLAND, BELGIUM, SLOVAKIA, LITHUANIA, ESTONIA, IRELAND, CROATIA, DENMARK, NETHERLANDS,
  FINLAND, SWEDEN, NORWAY,
];

/**
 * Every network's lowest tilts on one grid, DWD's included: the merged
 * composite the backend builds. Not one of
 * `NETWORKS`: it is not cut to a country and it stands in for all sixteen
 * products at once, on the live step, when the reader asks for it.
 */
export const EUROPE: Network = {
  code: "eu",
  fetch: fetchEuropeRadar,
  attribution: [dwdAttribution, ...NETWORKS.map((network) => network.attribution)].join(" "),
  // The merged composite's grid is the union of every network's.
  extent: [dwdRadarExtent, ...NETWORKS.map((network) => network.extent)].reduce(
    (whole, one) => extend(whole, one), createEmpty(),
  ),
  coverage: null,
};

/**
 * The column maximum of every network, on the merged composite's kind of
 * grid: every tilt of every radar rather than the lowest. Drawn
 * like `EUROPE`, whole and in place of the others, when the reader asks.
 */
export const EUROPE_COLUMN_MAXIMUM: Network = {
  ...EUROPE,
  code: "colmax",
  fetch: fetchEuropeColumnMaximum,
};

/**
 * What the column maximum's pass reads up each column of it: how high the
 * echo reaches 18, 45 and 50 dBZ, and its vertically integrated liquid. Each
 * on the column maximum's grid and drawn like it, whole and in place of the
 * others, when the reader asks; their tiles hold heights and kilograms rather
 * than RVP6, drawn by their encoding (`valueStyle`).
 */
export const EUROPE_ECHO_TOP_18: Network = { ...EUROPE_COLUMN_MAXIMUM, code: "echotop18", fetch: fetchEchoTop18 };

export const EUROPE_ECHO_TOP_45: Network = { ...EUROPE_COLUMN_MAXIMUM, code: "echotop45", fetch: fetchEchoTop45 };

export const EUROPE_ECHO_TOP_50: Network = { ...EUROPE_COLUMN_MAXIMUM, code: "echotop50", fetch: fetchEchoTop50 };

export const EUROPE_VIL: Network = { ...EUROPE_COLUMN_MAXIMUM, code: "vil", fetch: fetchVerticallyIntegratedLiquid };

/**
 * The column maximum of every network, cut to the ground the networks draw
 * on: what surrounds DMAX, Germany's own column maximum, in place of the
 * networks' lowest scans. Each network's coverage is wound to nest (its
 * holes for another country's islands against it) and no two overlap, so
 * their rings traced as one path are their union. Its frames are handed to it (`show`), never fetched: they are the
 * whole column maximum's.
 */
export const AROUND_DMAX: Network = {
  ...EUROPE_COLUMN_MAXIMUM,
  extent: NETWORKS.map((network) => network.extent).reduce((whole, one) => extend(whole, one), createEmpty()),
  coverage: NETWORKS.flatMap((network) => network.coverage ?? []),
};

/** For a layer that is only ever handed its frames. */
const handedFrames = async (): Promise<null> => null;

/**
 * Each network's run of meteocool's own nowcast, drawn on the
 * forecast steps it has a lead for while the experimental setting is on:
 * cut to the same ground as the network's composite, so WN, holed for it on
 * those steps (`networkHoles.ts`), and the run never draw on one pixel. Its
 * tiles are in the nowcast bucket, as WN's are; its frames come with the
 * timeseries (lib/nowcast.ts) and are handed to it, never fetched.
 */
export const NOWCAST_NETWORKS: Network[] = NETWORKS.map((network) => ({
  ...network,
  fetch: handedFrames,
  bucket: "meteonowcast",
}));

/**
 * One EUMETNET network's composite, drawn on its own (layers/radarDrawing.ts).
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

  /** Where its frames' tiles come from, made with the first frame. */
  private source: ValueTileSource | null = null;

  /** How it is drawn, from the first frame on: a slot of the map's frame layer, or a tile layer. */
  private layer: RadarDrawing | null = null;

  /** The URL the layer's source is on, so an unchanged step costs nothing. */
  private url = "";

  private live = true;

  /** The newest composite, from `refresh`. */
  private readonly latest: LatestFrame;

  /** This network's composite for the step on screen, when that is not the live one. */
  private stepFrame: RadarFrame | null = null;

  /** Told after every new live frame; the 3D map drapes the same one. */
  private readonly onLiveFrame: (() => void) | undefined;

  /** The palette the reader chose: the layer's look, so a change reloads nothing. */
  private palette = "classic";

  /** Grey in this ink under an open radar's sweep (`setPalette`), else null. */
  private ink: Ink | null = null;

  /**
   * What the bytes of the frame on screen mean, which the look follows
   * (`valueStyle`): RVP6 for every network's composite, a height or a weight
   * for an echo top's or VIL's.
   */
  private encoding = RVP6_ENCODING;

  /** How strongly it is drawn: the radar map's own, unless a map lays it under something else. */
  private readonly opacity: number;

  /** Dimmed under an open radar's own sweep (`compositeDim`, site mode). */
  private dim = 1;

  /** Faded further by the map it is drawn on, as the radar map fades it under an open storm (`setFade`). */
  private fade = 1;

  constructor(map: Map, network: Network, onLiveFrame?: () => void, opacity = NOWCAST_OPACITY) {
    this.map = map;
    this.network = network;
    this.latest = new LatestFrame(network.fetch);
    this.onLiveFrame = onLiveFrame;
    this.opacity = opacity;
    compositeDim.subscribe((value) => {
      this.dim = value;
      this.layer?.setOpacity(this.strength());
    });
  }

  /** Fade it by `factor` of its own strength, 1 for none. */
  setFade(factor: number) {
    this.fade = factor;
    this.layer?.setOpacity(this.strength());
  }

  private strength(): number {
    return this.opacity * this.dim * this.fade;
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

  /**
   * Draw this network in a palette from now on; in grey with an ink, under an
   * open radar's sweep. An echo top or VIL keeps its own colours whatever the
   * palette, but takes the ink like reflectivity (`valueStyle`).
   */
  setPalette(palette: string, ink: Ink | null = null) {
    this.palette = palette;
    this.ink = ink;
    this.layer?.setLook(this.encoding, palette, ink);
  }

  /**
   * The tiles to decode ahead of playback for `frame` where the map is
   * looking, at the view's `resolution`, as this layer's loader will be
   * handed them; at most `max`. None until the layer exists, which it does
   * from the first composite on, and none where the map is away from this
   * network's ground.
   */
  tileJobs(frame: RadarFrame, viewExtent: Extent, resolution: number, max: number): TileJob[] {
    const { source } = this;
    if (!source) return [];
    const extent = getIntersection(viewExtent, this.network.extent);
    if (isEmpty(extent)) return [];
    return source.tileJobs(this.urlOf(frame), frame.tiles, extent, resolution, max);
  }

  /** The pieces of `frame`'s coarse preview where the map is looking (`ValueTileSource.previewJobs`). */
  previewJobs(frame: RadarFrame, viewExtent: Extent, resolution: number): PreviewJob[] {
    const { source } = this;
    if (!source) return [];
    const extent = getIntersection(viewExtent, this.network.extent);
    if (isEmpty(extent)) return [];
    return source.previewJobs(this.urlOf(frame), frame.tiles, extent, resolution);
  }

  /** The frame `show` would put on screen now: the live one, the step's, or none. */
  shownFrame(): RadarFrame | null {
    return this.live ? this.latest.current() : this.stepFrame;
  }

  /** What a frame's tiles are fetched by: its template. */
  private urlOf(frame: RadarFrame): string {
    return tileSourceUrl(this.network.bucket ?? "meteoradar", drawnTileId(frame));
  }

  private apply() {
    const frame = this.shownFrame();
    if (!frame) {
      this.layer?.setVisible(false);
      return;
    }
    const url = this.urlOf(frame);
    const encoding = encodingOf(frame);
    if (!this.layer) {
      this.encoding = encoding;
      this.createLayer(url, frame);
    } else {
      if (encoding !== this.encoding) {
        this.encoding = encoding;
        this.layer.setLook(encoding, this.palette, this.ink);
      }
      if (url !== this.url) this.source?.setUrl(url, frame.tiles);
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
   * (`networkHoles.ts`) are the other half. The radar is not clipped at
   * render time, and nothing outside the coverage is even fetched.
   */
  private createLayer(url: string, frame: RadarFrame) {
    this.source = trackTileLoads(new ValueTileSource({
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
    this.layer = radarDrawing(this.map, this.source, {
      encoding: this.encoding,
      palette: this.palette,
      ink: this.ink,
      // Just under DWD's 80. The cut means they never cover the same pixel,
      // so this only settles which draws first. Europe's draws above DWD's
      // instead, which is hidden while it shows.
      order: this.network.coverage ? 79 : 81,
      opacity: this.strength(),
      // The rectangle is a cheap first pass; `coverage` is the real edge.
      extent: this.network.extent,
    });
  }

  destroy() {
    this.layer?.destroy();
    this.layer = null;
    this.source = null;
  }
}
