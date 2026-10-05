import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Style } from "ol/style";
import snow from "../assets/snow.png";
import { dwdValueLayer, setDwdCmap, tileSourceUrl } from "../layers/dwd";
import type ValueTileSource from "../layers/valueTiles";
import NetworkRadarLayer, { EUROPE, NETWORKS } from "../layers/network";
import LatestFrame from "../layers/latestFrame";
import { networkAt } from "../layers/networkAt";
import { ALL_NETWORKS } from "../layers/networkHoles";
import type { NetworkCode } from "../layers/networkHoles";
import { hasTile, sourceTile } from "../lib/tileIndex";
import type { TileIndex } from "../lib/tileIndex";
import { drawnTileId } from "../lib/rvp6";
import type { ValueTiles } from "../lib/rvp6";
import type { RadarFrame } from "../api";
import type { RadarScans } from "../lib/scans";
import {
  capDescription,
  capLatestObservation,
  capLastUpdated,
  capTimeIndicator,
  dryAtUser,
  lastFocus,
  inspectLatLon,
  latLon,
  live,
  radarCadence,
  radarColorScheme,
  radarStale,
  replay,
  selectedCell,
  setFrames,
  showForecastPlaybutton, snowLayerVisible, zoomlevel,
  observedProduct,
  radarProducts,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions, RadarSocket } from "./options";
import { isDry } from "../lib/dryness";
import Capability from "./Capability";
import { tileBaseUrl } from "../urls";
import { fetchColumnMaximum, fetchRadarTimeseries, fetchSnowOverlay } from "../api";
import { publishCadence } from "../lib/updateCadence";
import { isOutdated, showsLatestFrame } from "../lib/freshness";
import { DEFAULT_PRODUCT, drawnProduct, stepFrame } from "../lib/observedProduct";
import type { AlternativeProduct, NewestScans, ObservedProduct } from "../lib/observedProduct";
import { NOWCAST_OPACITY } from "../layers/ui";
import { whenVisible } from "../lib/wakeup";
import { timedFetch } from "../lib/timedFetch";
import { derived, get } from "svelte/store";
//import { MeteoTileCache, mcTileCache } from "../lib/TileCache";

const DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL = 12;

/** The grid's step, in seconds. */
const STEP_SECONDS = 5 * 60;
/** The most tiles one prefetch asks for: a few frames of a phone or a desktop viewport. */
const PREFETCH_MAX_TILES = 48;
/** How many prefetched URLs are remembered before the set is started afresh. */
const PREFETCH_REMEMBERED = 3000;

/**
 * What the radar layer fades to while it is known to be out of date.
 *
 * Enough that the map reads as "not the current picture" at a glance, not so
 * little that the frames stop being legible -- old radar is still the best
 * answer available until the new one lands a moment later.
 */
const STALE_OPACITY = NOWCAST_OPACITY * 0.45;

/**
 * How far the radar steps back while a cell's popup is open.
 *
 * Opening a cell puts its whole forecast on the map -- a dozen centroids and a
 * nest of dashed uncertainty ellipses, all of it thin one-pixel work in the
 * cell's own severity colour. Over a mature storm that lands on the loudest
 * pixels the radar has, reds and oranges at full strength, and the dashes
 * simply disappear into them.
 *
 * So the reflectivity drops back for as long as the popup is up. Not far: the
 * echo is the thing the track is being read *against*, and a comparison needs
 * both halves. A little over half strength is enough to let a one-pixel dash
 * win without the storm underneath it going away.
 */
const INSPECT_OPACITY = 0.55;

function setPattern(style) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const photo = new Image();
  photo.onload = function () {
    canvas.width = photo.width;
    canvas.height = photo.height;
    const pattern = context?.createPattern(photo, "repeat");
    if (pattern) style.getFill().setColor(pattern);
  };
  photo.src = snow;
}

/** One timestep of the playback grid, as the UI consumes it. */
export interface GridStep {
  dbz: number;
  url: string | null;
  tile_id: string;
  source: string;
  bucket?: string;
  /** When the backend produced this frame. Absent on the seeded placeholders. */
  processed_time?: number;
  /** When the radars measured it; a forecast step's run's issue time. */
  upstream_time?: number | null;
  /** Which tiles the frame has; see lib/tileIndex.ts. Absent on older frames. */
  tiles?: TileIndex | null;
  /** Where the frame's value tiles are, and what they hold; see lib/rvp6.ts. */
  values?: ValueTiles | null;
}

/** The ±2h five-minute grid the playback slider scrubs across. */
export interface GridConfig {
  grid: Record<number, GridStep>;
  start: number;
  end: number;
  now: number;
  length: number;
}

export default class RadarCapability extends Capability {
  /** The layer DWD's frames are drawn through, built with the first grid. */
  layer: BaseLayer | null;

  /** The tile source behind `layer`; its URL is swapped as playback moves. */
  source: ValueTileSource | null = null;

  layers: Record<string, BaseLayer>;

  /** The full grid, and the subset handed to the UI. */
  gridconfig!: GridConfig;

  clientGridConfig?: GridConfig;

  serverGrid: Record<number, GridStep> | null;

  clientGrid: Record<number, GridStep> | null;

  /** Where the forecast is sampled, if the client has shared a position. */
  latlon: [number, number] | null;

  /** A point the user tapped, which the forecast is sampled at instead. */
  inspectLatlon: [number, number] | null;

  trackingMode: string;

  serverTime: number;

  snowOverlay: VectorTileLayer | null;

  /**
   * The EUMETNET networks' composites -- tile layers of their own beside the
   * DWD grid/GridStep this class otherwise manages, each keeping its own live
   * frame. See `layers/network.ts` for why they stay separate.
   */
  private networks: NetworkRadarLayer[];

  /**
   * The merged European composite, drawn whole in place of DWD's frame and
   * the networks' on every observed step while it is the drawn product; see
   * `showNetworks`. Its newest frame is fetched whatever is drawn, for the
   * picker's age.
   */
  private europe: NetworkRadarLayer;

  /**
   * DWD's column maximum, newest frame: drawn through DWD's own layer, on
   * HX's grid and with HX's holes, while it is the drawn product; see
   * `dwdFrame`. Fetched whatever is drawn, like the merged composite.
   */
  private dmax = new LatestFrame(fetchColumnMaximum);

  /** The product the reader picked; see lib/observedProduct.ts. */
  private chosen: ObservedProduct = DEFAULT_PRODUCT;

  /** The product the map draws: the choice, or the default while it falls behind. */
  private drawn: ObservedProduct = DEFAULT_PRODUCT;

  private unsubscribeProduct: (() => void) | null = null;

  /**
   * The chosen product's frame for each observed step it has one for, from
   * the same response as the grid when the request asked for it.
   */
  private productGrid: Partial<Record<AlternativeProduct, Record<number, RadarFrame>>> = {};

  /**
   * Each network's composite for each observed step it has one for, from the
   * same response as the grid. What the network layers show off the live
   * frame, and which steps' DWD tiles have that network cut out.
   */
  private networkGrid: Partial<Record<NetworkCode, Record<number, RadarFrame>>> = {};

  /** Mirror of the radarStale store, so the layer can be dimmed without a get(). */
  stale: boolean;

  /** Whether a cell's popup is open, which is the other reason to dim it. */
  private inspecting = false;

  private nanobar: NanobarWrapper;

  private socket_io?: RadarSocket;

  /** Kept so destroy() can take these back off the socket again. */
  private pokeHandler: (() => void) | null = null;

  private snowHandler: (() => void) | null = null;

  private networkHandler: ((event: { network: string }) => void) | null = null;

  private unsubscribeLiveFrame: (() => void) | null = null;

  /** The self-rescheduling grid refresh, so destroy() can stop it. */
  private gridRefreshTimeout: number | null = null;

  /** Numbers each timeseries request, in the order they were sent. */
  private gridRequests = 0;

  /** The newest request whose answer has been applied; see `downloadCurrentRadar`. */
  private gridApplied = 0;

  /** Where the grid in hand was sampled, as `positionKey` put it; see `sampledHere`. */
  private gridSampledAt: string | null = null;

  /** The snow overlay's request in flight, for `loaded`. */
  private snowRequest: Promise<void> = Promise.resolve();

  /**
   * The first grid, every network's newest frame and the snow overlay,
   * settled either way: every layer the first picture has is on the map by
   * then, though not yet its tiles. What a screenshot waits on before it
   * waits for the map to draw; see lib/screenshot.ts.
   */
  loaded: Promise<unknown> = Promise.resolve();

  constructor(map: Map, additionalLayers: BaseLayer[], options: CapabilityOptions) {
    super(map, "radar", () => {
      capDescription.set("Radar Reflectivity");
      showForecastPlaybutton.set(true);
    }, additionalLayers);

    this.layer = null;
    this.layers = {};
    this.nanobar = options.nanobar!;
    this.socket_io = options.socket_io;
    this.latlon = null;
    this.inspectLatlon = null;
    this.serverGrid = null;
    this.clientGrid = null;
    this.trackingMode = "live";
    this.serverTime = 0;
    this.snowOverlay = null;
    this.stale = false;
    // Observers hear of every network's new live frame: the 3D map drapes
    // the same one, forwarded from App.svelte like DWD's grid is.
    this.networks = NETWORKS.map((network) => new NetworkRadarLayer(
      map, network, () => this.notify("networks", this.liveNetworkFrames()),
    ));
    // Not an observer's business: the 3D map drapes HX and the networks
    // whatever the flat map draws.
    this.europe = new NetworkRadarLayer(map, EUROPE, () => this.productsChanged());
    this.unsubscribeProduct = observedProduct.subscribe((product) => {
      this.chosen = product;
      // Its past comes with the grid, asked for by name: a grid already in
      // hand was asked for without it. The first call is construction, whose
      // own first request below asks.
      if (product !== DEFAULT_PRODUCT && this.serverGrid && !this.productGrid[product]) this.reloadRadar();
      this.productsChanged();
    });

    /* The networks follow the scrubber: their own newest frame on the live
       one, the grid's composite on any other past step, nothing on a forecast
       step. "Live" is the same predicate as the cell layer's gate in
       App.svelte, so the two never disagree about which frame it is. */
    this.unsubscribeLiveFrame = derived(
      [capTimeIndicator, capLatestObservation],
      ([shown, newest]) => [shown, showsLatestFrame(shown, newest)] as const,
    ).subscribe(([shown, onLiveFrame]) => this.showNetworks(shown, onLiveFrame));

    window.radar = this;

    //mcTileCache.setMap(map);
    radarColorScheme.subscribe((colorScheme) => {
      // Every radar layer's palette is its style (lib/rvp6.ts): restyled in
      // place, with nothing reloaded and the grid neither refetched nor
      // re-announced.
      setDwdCmap(colorScheme);
      for (const network of [...this.networks, this.europe]) network.setPalette(colorScheme);
    });

    latLon.subscribe((latlonUpdate) => {
      if (!latlonUpdate) {
        dryAtUser.set(false);
        return true;
      }
      const [lat, lon] = latlonUpdate;
      if (this.latlon) {
        const [oldLat, oldLon] = this.latlon;
        if (Math.abs(oldLat - lat) > 0.001 || Math.abs(oldLon - lon) > 0.001) {
          this.latlon = latlonUpdate;
          this.reloadRadar();
        }
      } else {
        this.latlon = latlonUpdate;
        this.reloadRadar();
      }
    });

    /* A tapped point wins over the client's own: the strip is answering the
       question that was just asked, not the standing one. */
    inspectLatLon.subscribe((point) => {
      const before = this.inspectLatlon;
      this.inspectLatlon = point;
      // The store publishes its initial null to every new subscriber; only an
      // actual change is worth a round trip to the backend.
      if (before === point) return;
      if (before && point && before[0] === point[0] && before[1] === point[1]) return;
      this.reloadRadar();
    });

    /* Order matters: the verdict is published before the refetch goes out, so
       the map says it is out of date for the round trip rather than after it.
       Not on the subscription's own first call, which is construction rather
       than a wake: the constructor fetches everything once below. */
    let firstFocus = true;
    lastFocus.subscribe(() => {
      if (firstFocus) {
        firstFocus = false;
        return;
      }
      this.refreshStaleness();
      this.reloadAll();
      this.downloadSnowOverlay();
    });

    radarStale.subscribe((value) => {
      this.stale = value;
      this.applyRadarOpacity();
    });

    /* The popup carries the cell's forecast onto the map with it, which is
       what needs the room; there is nothing to make room for once it closes. */
    selectedCell.subscribe((track) => {
      const open = track !== null;
      if (open === this.inspecting) return;
      this.inspecting = open;
      this.applyRadarOpacity();
    });

    live.subscribe((value) => {
      if (this.snowOverlay) {
        this.snowOverlay.setVisible(value);
      }
    });

    snowLayerVisible.subscribe((value) => {
      if (value) {
        this.snowRequest = this.downloadSnowOverlay();
      } else {
        this.processSnowOverlay({ active: false });
      }
    });

    zoomlevel.subscribe((z) => {
      if (this.snowOverlay) {
        this.snowOverlay.setOpacity(z > DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL ? 0.5 : 1);
      }
    });

    /* Each nudge is one fetch, and none of them is for a hidden tab: put off
       until the page is looked at, and collapsed to the newest of its kind
       while it waits (lib/wakeup.ts). */
    if (this.socket_io) {
      // DWD's grid only. The networks have their own event below, and reloading
      // all four with every poke was four requests every five minutes to
      // learn nothing.
      this.pokeHandler = () => {
        whenVisible("radar:poke", () => {
          console.log("received websocket poke, refreshing tiles + forecasts");
          this.reloadRadar();
        });
      };
      this.snowHandler = () => {
        whenVisible("radar:snow", () => {
          console.log("received websocket snow overlay poke, refreshing");
          this.downloadSnowOverlay();
        });
      };
      // One network's composite, the merged one or DMAX, re-rendered:
      // refetch that one frame only. Not `poke`, which reloads DWD's whole
      // timeseries, and these land every minute or two.
      this.networkHandler = ({ network }) => {
        whenVisible(`radar:network:${network}`, () => {
          if (network === EUROPE.code) {
            this.europe.refresh(this.nanobar);
            return;
          }
          if (network === "dmax") {
            this.refreshColumnMaximum();
            return;
          }
          this.networks.find((layer) => layer.network.code === network)?.refresh(this.nanobar);
        });
      };
      this.socket_io.on("poke", this.pokeHandler);
      this.socket_io.on("snow", this.snowHandler);
      this.socket_io.on("network", this.networkHandler);
      this.loaded = Promise.allSettled([
        this.downloadCurrentRadar(),
        ...this.networks.map((network) => network.refresh(this.nanobar)),
        this.europe.refresh(this.nanobar),
        this.refreshColumnMaximum(),
        this.snowRequest,
      ]);
    }

    // Initialize grid
    this.gridconfig = this.regenerateGridConfig();
    const restartHandler = () => {
      this.gridRefreshTimeout = window.setTimeout(restartHandler, 60000);
      this.gridconfig = this.regenerateGridConfig();
      if (this.serverGrid) {
        this.updateClientGridFromServerGrid(this.serverGrid);
        this.notify("grid", this.clientGridConfig);
      }
    };
    // A screenshot is taken and closed long before the grid moves on.
    if (!options.screenshot) restartHandler();
  }

  updateClientGridFromServerGrid(server) {
    let latestRadar = new Date(0);
    const body = { ...this.gridconfig.grid };

    latestRadar = new Date(this.serverTime * 1000);

    Object.keys(server).forEach((step) => {
      const layerAttributes = server[step];
      if (!(step in body)) {
        console.log("step not in body");
        return;
      }
      if (!layerAttributes) {
        body[step] = null;
        return;
      }

      const bucket = layerAttributes.source === "observation" ? "meteoradar" : "meteonowcast";
      // The frame's value tiles. Everything keyed by URL -- indices, holes,
      // prefetch -- follows.
      const sourceUrl = tileSourceUrl(bucket, drawnTileId(layerAttributes));

      body[step] = layerAttributes;
      body[step].bucket = bucket;
      body[step].url = sourceUrl;

      if (layerAttributes.source === "observation") {
        const processedDt = new Date(layerAttributes.processed_time * 1000);
        if (processedDt > latestRadar) latestRadar = processedDt;
      }
    });
    this.clientGrid = body;
    this.clientGridConfig = { ...this.gridconfig, grid: body };
    return latestRadar;
  }

  /** Tile URLs already asked for ahead of playback, so a loop asks once. */
  private prefetched = new Set<string>();

  /**
   * Fetch the tiles the next few frames will need where the map is looking.
   *
   * Playback re-points one source at a frame every 450ms, and the tiles for
   * the frame arrive after the switch: the first loop through a viewport
   * shows each frame half-loaded for the first few hundred milliseconds. This
   * asks for the next `count` frames' tiles for the current viewport and
   * zoom before the player gets there, through `fetch`, so they are in the
   * HTTP cache -- and the service worker's -- when OpenLayers asks.
   *
   * Only worth it when the tiles are cacheable at all, which they are by URL
   * (a tile_id names one rendering). The bytes are the same either way; what
   * moves is when they are asked for.
   */
  prefetchFrames(fromStep: number, count: number) {
    const { source } = this;
    if (!source || !this.clientGrid) return;
    const view = this.map.getView();
    const size = this.map.getSize();
    const resolution = view.getResolution();
    if (!size || resolution === undefined) return;
    const tileGrid = source.getTileGridForProjection(view.getProjection());
    const z = tileGrid.getZForResolution(resolution);
    const extent = view.calculateExtent(size);
    const last = this.getLastPlayableStep();

    const urls: string[] = [];
    for (let step = fromStep + STEP_SECONDS, n = 0; step <= last && n < count; step += STEP_SECONDS, n += 1) {
      const frame = this.dwdFrame(step);
      if (!frame) break;
      const { url: template, tiles: index } = frame;
      tileGrid.forEachTileCoord(extent, z, ([tz, tx, ty]) => {
        if (urls.length >= PREFETCH_MAX_TILES) return;
        // Past a frame's deepest zoom its tiles come out of their ancestor's.
        const { z: sz, x, y } = sourceTile(index, tz, tx, ty);
        // A tile the frame does not have is answered locally; see lib/tileIndex.ts.
        if (!hasTile(index, sz, x, 2 ** sz - 1 - y)) return;
        const url = template
          .replace("{z}", String(sz))
          .replace("{x}", String(x))
          .replace("{-y}", String(2 ** sz - 1 - y))
          .replace("{y}", String(y));
        if (!urls.includes(url)) urls.push(url);
      });
    }

    // The networks' frames for the same steps: over their countries DWD's
    // tiles are holes, so without these playback there is half-loaded anyway.
    // Or the merged composite's, on the steps it stands in for all of them.
    const ahead: number[] = [];
    for (let step = fromStep + STEP_SECONDS, n = 0; step <= last && n < count; step += STEP_SECONDS, n += 1) {
      ahead.push(step);
    }
    const merged = ahead.map((step) => this.alternativeFrame("merged", step));
    for (const network of this.networks) {
      const frames = ahead
        .filter((_step, i) => !merged[i])
        .map((step) => this.networkGrid[network.network.code]?.[step])
        .filter((frame): frame is RadarFrame => Boolean(frame));
      if (frames.length) urls.push(...network.tileUrls(frames, PREFETCH_MAX_TILES));
    }
    const europe = merged.filter((frame): frame is RadarFrame => frame !== null);
    if (europe.length) urls.push(...this.europe.tileUrls(europe, PREFETCH_MAX_TILES));

    if (this.prefetched.size > PREFETCH_REMEMBERED) this.prefetched.clear();
    for (const url of urls) {
      if (this.prefetched.has(url)) continue;
      this.prefetched.add(url);
      // Same request the tile loader makes -- a CORS one, no credentials --
      // so the cache entry is the one it will look for. The body is read to
      // the end: a response left unread is not stored.
      timedFetch(url, { mode: "cors", credentials: "same-origin", priority: "low" } as RequestInit)
        .then((response) => (response.ok ? response.arrayBuffer() : undefined))
        .catch(() => { this.prefetched.delete(url); });
    }
  }

  regenerateGridConfig() {
    let gridNow = new Date().getTime() / 1000;
    gridNow -= (gridNow % (60 * 5));
    const start = gridNow - (60 * 120);
    const end = gridNow + (60 * 120);
    const nSteps = ((end - start) / (60 * 5)) + 1;

    const grid: Record<number, GridStep> = {};
    [...Array(nSteps).keys()]
      .map((i) => new Date(start + i * (5 * 60)))
      .forEach((step) => {
        grid[step.getTime()] = {
          dbz: 0,
          url: null,
          tile_id: "",
          source: "",
        };
      });

    return {
      grid, start, end, now: gridNow, length: nSteps,
    };
  }

  setUrl(url: string) {
    this.source?.setUrl(url);
  }

  /** Whether DWD's frames have a layer to be drawn by, which they do from the first grid on. */
  get hasFrameLayer(): boolean {
    return this.source !== null;
  }

  /**
   * Re-judge whether the frames we hold have been overtaken, and say so.
   *
   * Called when the page wakes, which is the moment it can be true without
   * anything having happened: no frame changed, the clock did. Only ever turns
   * it *on* -- the grid that answers the refetch turns it off, so a slow
   * response cannot clear the warning before the data it is warning about has
   * actually been replaced.
   */
  refreshStaleness() {
    if (!this.clientGrid) return;
    if (!isOutdated(this.getMostRecentObservation(), Date.now() / 1000, get(radarCadence))) return;
    radarStale.set(true);
    live.set(false);
  }

  /**
   * The radar layer's opacity, as one sum rather than two writers.
   *
   * Staleness and the open popup both want to dim it and neither knows about
   * the other, so each one setting it directly would mean whichever fired last
   * won: closing a popup over stale radar would quietly restore it to full
   * strength and drop the outdated warning with it. Both are flags here and
   * the opacity is computed from them, so they compose -- stale radar being
   * inspected is dimmer still, and each one is undone only by its own cause.
   */
  private applyRadarOpacity() {
    const base = this.stale ? STALE_OPACITY : NOWCAST_OPACITY;
    this.layer?.setOpacity(this.inspecting ? base * INSPECT_OPACITY : base);
  }

  /** Each network's newest composite, where it is fresh enough to draw: what the live step shows. */
  liveNetworkFrames(): Partial<Record<NetworkCode, RadarFrame>> {
    const frames: Partial<Record<NetworkCode, RadarFrame>> = {};
    for (const network of this.networks) {
      const frame = network.current();
      if (frame) frames[network.network.code] = frame;
    }
    return frames;
  }

  /**
   * The scans of the radar the live step shows on the 3D map: what a storm's
   * volume is judged against, drawn grey there when older. The same frames
   * App.svelte drapes there, DWD's and each network's own, whichever product
   * the flat map draws.
   */
  liveRadarScans(): RadarScans {
    const step = this.getMostRecentObservation();
    return {
      scan: this.clientGrid?.[step]?.url ? step : null,
      networks: this.liveNetworkFrames(),
    };
  }

  /** Everything: DWD's grid and every other product's frame. For a wake, where any of it may have moved on. */
  reloadAll() {
    console.log("reloadAll");
    this.reloadRadar();
    for (const network of this.networks) network.refresh(this.nanobar);
    this.europe.refresh(this.nanobar);
    this.refreshColumnMaximum();
  }

  /** DMAX's newest frame, and whatever that changes on the map. */
  private async refreshColumnMaximum() {
    await this.dmax.refresh(this.nanobar);
    this.productsChanged();
  }

  /** Each product's newest scan, where it has a fresh frame: what the picker ages, and the fallback judges. */
  private newestScans(): NewestScans {
    const step = this.getMostRecentObservation();
    const newest = this.clientGrid?.[step];
    return {
      hx: newest?.url && newest.source === "observation" ? (newest.upstream_time ?? step) : null,
      merged: this.europe.current()?.upstream_time ?? null,
      dmax: this.dmax.current()?.upstream_time ?? null,
    };
  }

  /**
   * Re-decide what the map draws, after anything that can change it -- the
   * reader's choice, or a new frame of any of the three products -- say so to
   * the picker, and put it on the step on screen.
   */
  private productsChanged() {
    const scans = this.newestScans();
    this.drawn = drawnProduct(this.chosen, scans);
    radarProducts.set({ chosen: this.chosen, drawn: this.drawn, scans });
    const shown = get(capTimeIndicator);
    const url = this.dwdFrame(shown)?.url;
    if (this.source && url) {
      // Indices first: the frame `setHoles` re-points at consults them.
      this.source.setIndices(this.indices());
      this.source.setHoles(this.holes(), url);
    }
    this.showNetworks(shown, showsLatestFrame(shown, this.getMostRecentObservation()));
  }

  /**
   * The drawn product's own frame for a step, when that is `product` and it
   * has one there; null where the default stands. See `stepFrame`.
   */
  private alternativeFrame(product: AlternativeProduct, step: number): RadarFrame | null {
    const frame = this.clientGrid?.[step];
    return stepFrame(
      product,
      this.drawn,
      { observed: frame?.source === "observation" && Boolean(frame.url), live: step === this.getMostRecentObservation(), key: step },
      this.productGrid[product],
      product === "dmax" ? this.dmax.current() : this.europe.current(),
    );
  }

  /**
   * What DWD's layer draws on a step, and which tiles that frame has: DMAX's
   * frame there while it is the drawn product and has one, else the grid's --
   * HX's, or WN's on a forecast step. Null where the grid has nothing yet.
   */
  private dwdFrame(step: number): { url: string; tiles?: TileIndex | null } | null {
    const frame = this.clientGrid?.[step];
    if (!frame?.url) return null;
    const dmax = this.alternativeFrame("dmax", step);
    if (dmax) return { url: tileSourceUrl("meteoradar", drawnTileId(dmax)), tiles: dmax.tiles };
    return { url: frame.url, tiles: frame.tiles };
  }

  /**
   * DWD's grid alone. The networks are on their own cadence with their own
   * socket event, and nothing that changes the grid -- a poke, a new sample
   * position, a palette -- changes them.
   */
  reloadRadar() {
    this.downloadCurrentRadar();
  }

  /** Which tiles each frame DWD's layer draws has, by the frame's URL; see lib/tileIndex.ts. */
  private indices(): globalThis.Map<string, TileIndex | null | undefined> {
    const indices = new globalThis.Map<string, TileIndex | null | undefined>();
    for (const key of Object.keys(this.clientGrid ?? {})) {
      const frame = this.dwdFrame(parseInt(key, 10));
      if (frame) indices.set(frame.url, frame.tiles);
    }
    return indices;
  }

  /**
   * Which networks to cut out of which of DWD's frames: on each observed step,
   * those the grid has a composite for, and on the live one all of them --
   * those layers bring their own newest frame there, whatever the grid says.
   */
  private holes(): globalThis.Map<string, NetworkCode[]> {
    const holes = new globalThis.Map<string, NetworkCode[]>();
    const newest = this.getMostRecentObservation();
    for (const [key, frame] of Object.entries(this.clientGrid ?? {})) {
      if (!frame?.url || frame.source !== "observation") continue;
      const step = parseInt(key, 10);
      const codes = step === newest
        ? ALL_NETWORKS
        : ALL_NETWORKS.filter((code) => this.networkGrid[code]?.[step]);
      if (!codes.length) continue;
      // DMAX's newest frame is drawn on the live step and is usually also the
      // step before's, a cycle behind HX: one URL, cut for both.
      const url = this.dwdFrame(step)!.url;
      const already = holes.get(url) ?? [];
      holes.set(url, ALL_NETWORKS.filter((code) => codes.includes(code) || already.includes(code)));
    }
    return holes;
  }

  /**
   * Point every network layer at the step on screen.
   *
   * On an observed step the merged composite is drawn on, while it is the
   * drawn product, that one frame stands in for all five products: DWD's
   * layer and the networks' are hidden under it rather than blended with it,
   * since every palette is part transparent and two drawn together read as a
   * third intensity.
   */
  private showNetworks(shown: number, live: boolean) {
    const europe = this.alternativeFrame("merged", shown);
    for (const network of this.networks) {
      network.show(live && !europe, europe ? null : this.networkGrid[network.network.code]?.[shown] ?? null);
    }
    // The frame itself, the live one included: `alternativeFrame` has
    // already judged the newest fresh.
    this.europe.show(false, europe);
    this.layer?.setVisible(!europe);
  }

  /**
   * Where the forecast is sampled: a tapped point, else the client's own --
   * with the network the map draws there, whose composites the past half of
   * the strip is then read from.
   */
  getPosition() {
    const at = this.inspectLatlon ?? this.latlon;
    if (!at) return undefined;
    const [lat, lon] = at;
    const network = networkAt(lat, lon);
    return network ? { lat, lon, network } : { lat, lon };
  }

  /** The position the forecast is sampled at, as a key two of them can be compared by. */
  private positionKey(): string {
    return JSON.stringify(this.getPosition() ?? null);
  }

  /**
   * Whether the grid in hand was sampled where the forecast is sampled now.
   *
   * Not after a tap whose own request failed: the grid is still the last
   * point's, and the strip drawing its bars under the new point's name would
   * be a forecast for somewhere else. The strip keeps its skeleton up until
   * an answer for the new point lands, which the recovery retries bring.
   */
  sampledHere(): boolean {
    return this.gridSampledAt === this.positionKey();
  }

  async downloadCurrentRadar() {
    live.set(false);
    // Taken with the position, before the round trip: a point tapped while the
    // request is out must not have the answer for the client's own position
    // read as the answer for it, or the other way round.
    const forUser = this.inspectLatlon === null && this.latlon !== null;
    const at = this.positionKey();
    this.gridRequests += 1;
    const request = this.gridRequests;
    const product = this.chosen === "hx" ? null : this.chosen;
    const data = await fetchRadarTimeseries(this.nanobar, this.getPosition(), product).catch(() => null);
    if (!data) {
      live.set(false);
      return;
    }
    /* A poke, a wake, a tap and the retries a bad network brings all send
       one of these, and they need not answer in order. Older than one
       already applied, this one would put the previous grid -- or another
       point's forecast -- back. */
    if (request < this.gridApplied) return;
    this.gridApplied = request;
    this.gridSampledAt = at;
    this.processRadar(data);
    if (forUser) dryAtUser.set(isDry(data.frames));
  }

  async downloadSnowOverlay() {
    if (!get(snowLayerVisible)) return;
    const data = await fetchSnowOverlay(this.nanobar).catch(() => null);
    if (!data) return;
    this.processSnowOverlay(data);
  }

  processSnowOverlay(obj) {
    const URL = `${tileBaseUrl}/meteoradar/${obj.tile_id}/{z}/{x}/{y}.pbf`;
    if (this.snowOverlay) {
      if (obj.active) {
        console.log("Updating snow overlay URL");
        this.snowOverlay.getSource()?.setUrl(URL);
      } else {
        console.log("No more snow :(");
        this.map.removeLayer(this.snowOverlay);
        this.snowOverlay = null;
      }
    } else if (obj.active) {
      console.log("Initializing snow overlay");
      const style = new Style({ fill: new Fill() });
      setPattern(style);
      this.snowOverlay = new VectorTileLayer({
        zIndex: 90,
        source: new VectorTileSource({
          format: new MVT(),
          url: URL,
          maxZoom: 5,
          minZoom: 0,
        }),
        style,
        opacity: get(zoomlevel) > DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL ? 0.5 : 1,
      });
      this.map.addLayer(this.snowOverlay);
    }
  }

  /** Whether the poke channel is up, for the diagnostics panel. */
  get socketConnected(): boolean | null {
    return this.socket_io ? this.socket_io.connected === true : null;
  }

  notifyObservers() {
    this.notify("grid", this.clientGridConfig);
  }

  /**
   * The newest step the map can show as "now".
   *
   * This used to seed with serverTime and only ever raise it to an observation
   * newer than that -- which no observation ever is, so the loop was dead and
   * the function returned the server's clock under an observation's name. That
   * held together only because on production the step at server_time happens to
   * BE the newest observation. On a backend that publishes no observations at
   * all it silently returned a forecast step instead, and any caller that looks
   * the result up in the grid (resetToLatest, processRadar's first layer,
   * the scrubber's initial value) depends on it being a real step.
   *
   * Preference order: the newest observation; failing that the newest step at
   * or before the server's clock that has a frame; failing that the clock
   * itself, which is all there is left when the grid is empty.
   */
  getMostRecentObservation(): number {
    let newestObservation = 0;
    let newestBeforeNow = 0;
    for (const [key, frame] of Object.entries(this.clientGrid ?? {})) {
      // No url means the step is not published yet, and the rest of the grid
      // behind it is not either -- same prefix rule as getLastPlayableStep().
      if (!frame || !frame.url) break;
      const step = parseInt(key, 10);
      if (frame.source === "observation") newestObservation = step;
      if (step <= this.serverTime) newestBeforeNow = step;
    }
    return newestObservation || newestBeforeNow || this.serverTime;
  }

  /**
   * The newest step that actually has a frame behind it.
   *
   * The grid always runs to gridconfig.end, but the tail of the nowcast is
   * published a few steps behind that: those entries come back null, or stay
   * the empty placeholder regenerateGridConfig() seeded. setSource() then has
   * no url to hand the layer and leaves the previous tile on the map, so the
   * clock advances while the radar does not -- which reads as a freeze.
   *
   * Stops at the first hole rather than skipping it, like
   * getMostRecentObservation(): the published steps are a prefix of the grid.
   */
  getLastPlayableStep(): number {
    let last = 0;
    for (const [step, frame] of Object.entries(this.clientGrid ?? {})) {
      if (!frame || !frame.url) break;
      last = parseInt(step, 10);
    }
    return last || this.gridconfig.end;
  }

  processRadar(obj) {
    if (!obj) return;

    this.serverGrid = obj.frames;
    this.networkGrid = obj.networks ?? {};
    this.productGrid = obj.products ?? {};
    this.serverTime = obj.server_time;
    // The backend is the only thing that knows: a replay is built to be
    // indistinguishable from here, so there is nothing in the frames to infer
    // it from.
    replay.set(Boolean(obj.replay));
    this.gridconfig = this.regenerateGridConfig();
    const latestRadar = this.updateClientGridFromServerGrid(this.serverGrid);
    // Before any URL is chosen below: whether DMAX is drawn decides which.
    this.drawn = drawnProduct(this.chosen, this.newestScans());

    if (!this.layer) {
      const last = this.clientGrid?.[this.getMostRecentObservation()];
      if (last?.url) {
        [this.layer, this.source] = dwdValueLayer(last);
        this.map.addLayer(this.layer);
      }
    }
    // Before any setUrl below: the step being moved onto is the one whose
    // holes matter. Following live, that step is the newest, so it is named
    // here and the frame being left is not re-keyed on the way out.
    const newestUrl = this.dwdFrame(this.getMostRecentObservation())?.url;
    if (newestUrl) {
      // Indices first: the frame `setHoles` re-points at consults them.
      this.source?.setIndices(this.indices());
      this.source?.setHoles(this.holes(), this.trackingMode === "live" ? newestUrl : undefined);
    }
    switch (this.trackingMode) {
      case "live":
        // Publishes the pair itself: following the grid means the indicator
        // moves onto the new observation, and both halves have to reach
        // anything reading them as one update. See `setFrames`.
        this.resetToLatest();
        break;
      case "manual":
        // if ("server_time" in obj) {
        //  const wantTimestep = this.gridconfig.now + Math.abs(obj.server_time - this.gridconfig.now);
        //  console.log(`wanttimestep=${wantTimestep}`);
        //  if (wantTimestep in this.gridconfig.grid) {
        //    this.setSource(wantTimestep);
        //  }
        // }
        break;
      default:
        break;
    }
    // Whatever the mode, the grid's newest step is on record: layers that only
    // make sense on the live frame read it against the indicator -- see the
    // cell layer's gate in App.svelte. On the live path `resetToLatest` has
    // already said this and the write is a no-op; on a manual scrubber it is
    // the one that matters, and it leaves the indicator where the reader put
    // it, now measurably behind.
    setFrames({ newest: this.getMostRecentObservation() });
    // A new grid can carry composites for the step on screen that the last
    // one did not, and the indicator has not moved to say so -- and HX's
    // newest scan, which the other products are measured against.
    this.productsChanged();
    capLastUpdated.set(latestRadar);
    this.publishCadenceFromGrid();
    radarStale.set(false);
    this.applyRadarOpacity();
    this.notify("grid", this.clientGridConfig);
  }

  /**
   * Work out when the next frame is due, from when the last ones arrived.
   *
   * Observations only. Every forecast frame in a grid is rebuilt on the same
   * pass and stamped with the same processed_time, so including them would
   * report a cadence of nothing at all; the observations are the ones that
   * appear one at a time, on the backend's actual rhythm.
   *
   * Cheap enough to do on every grid -- a couple of dozen numbers -- and doing
   * it here rather than in the panel means the prediction exists whether or not
   * anyone has the diagnostics open, which is what the degraded criteria need.
   */
  private publishCadenceFromGrid() {
    const published = Object.values(this.clientGrid ?? {})
      .filter((frame) => frame && frame.source === "observation")
      .map((frame) => frame!.processed_time)
      .filter((t): t is number => typeof t === "number" && t > 0);
    radarCadence.set(publishCadence(published));
  }

  resetToLatest() {
    const mostRecent = this.getMostRecentObservation();
    // A step can be in the grid and still null: before anything is published,
    // the newest observation falls back to the server's clock, a placeholder.
    const step = this.clientGrid?.[mostRecent];
    if (step) {
      const url = this.dwdFrame(mostRecent)?.url;
      if (this.source && url) this.source.setUrl(url);
      // Both halves: the newest observation is what is being reset onto, so
      // there is no tick in which the two disagree.
      setFrames({ shown: mostRecent, newest: mostRecent });
      live.set(true);
    }
  }

  setSource(timestep: number) {
    if (!this.source) return;
    this.source.refresh();
    if (this.trackingMode !== "manual") {
      this.trackingMode = "manual";
      live.set(false);
    }
    if (timestep === this.gridconfig.now) {
      this.trackingMode = "live";
      live.set(true);
    }
    setFrames({ shown: timestep });
    const frame = this.dwdFrame(timestep);
    if (frame) this.source.setUrl(frame.url);
  }

  destroy() {
    for (const network of this.networks) network.destroy();
    this.europe.destroy();
    this.unsubscribeProduct?.();
    this.unsubscribeProduct = null;
    this.unsubscribeLiveFrame?.();
    this.unsubscribeLiveFrame = null;
    if (this.gridRefreshTimeout !== null) {
      window.clearTimeout(this.gridRefreshTimeout);
      this.gridRefreshTimeout = null;
    }
    if (this.socket_io) {
      if (this.pokeHandler) {
        this.socket_io.off("poke", this.pokeHandler);
        this.pokeHandler = null;
      }
      if (this.snowHandler) {
        this.socket_io.off("snow", this.snowHandler);
        this.snowHandler = null;
      }
      if (this.networkHandler) {
        this.socket_io.off("network", this.networkHandler);
        this.networkHandler = null;
      }
    }
  }

  //    caches.delete("radar-tile-cache");
}
