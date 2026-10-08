import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Style } from "ol/style";
import snow from "../assets/snow.png";
import { dwdValueLayer, setDwdCmap, tileSourceUrl } from "../layers/dwd";
import { frameOnStep, templateOf } from "../layers/valueTiles";
import type ValueTileSource from "../layers/valueTiles";
import NetworkRadarLayer, { AROUND_DMAX, EUROPE, EUROPE_COLUMN_MAXIMUM, NETWORKS } from "../layers/network";
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
import {
  DEFAULT_PRODUCT, aroundFrame, drawnProduct, fallsBehind, givesUpChoice, scanRange, stepFrame, timeseriesProducts,
} from "../lib/observedProduct";
import type { AlternativeProduct, NewestScans, ObservedProduct, ScanRange } from "../lib/observedProduct";
import { NOWCAST_OPACITY } from "../layers/ui";
import { whenVisible } from "../lib/wakeup";
import { timedFetch } from "../lib/timedFetch";
import { derived, get } from "svelte/store";
import { _ } from "svelte-i18n";
import { reportToast } from "../lib/Toast";
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
 * Faint enough that the map reads as "not the current picture" at a glance,
 * strong enough that the frames stay legible. Old radar is still the best
 * answer available until the new one lands a moment later.
 */
const STALE_OPACITY = NOWCAST_OPACITY * 0.45;

/**
 * How far the radar steps back while a cell's popup is open.
 *
 * Opening a cell puts its whole forecast on the map: a dozen centroids and a
 * nest of dashed uncertainty ellipses, all thin one-pixel lines in the cell's
 * own severity colour. Over a mature storm they land on the radar's strongest
 * pixels, reds and oranges at full strength, and the dashes disappear into
 * them.
 *
 * So the reflectivity drops back while the popup is up, but only a little: the
 * track is read *against* the echo, so both have to show. A little over
 * half strength lets a one-pixel dash stand out while the storm underneath
 * stays visible.
 */
const INSPECT_OPACITY = 0.55;

/** A list of products as one string, to tell two requests' apart. */
const productsKey = (products: readonly AlternativeProduct[]): string => products.join(",");

/** The products of every network at once, each drawn whole in place of the six; see `showNetworks`. */
const WHOLE_PRODUCTS = ["merged", "colmax"] as const satisfies readonly AlternativeProduct[];
type WholeProduct = (typeof WHOLE_PRODUCTS)[number];

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
   * The EUMETNET networks' composites: tile layers of their own beside the
   * DWD grid/GridStep this class otherwise manages, each keeping its own live
   * frame. See `layers/network.ts` for why they stay separate.
   */
  private networks: NetworkRadarLayer[];

  /**
   * The two products of every network at once (the merged composite of
   * their lowest tilts, and their column maximum), each drawn whole in place
   * of DWD's frame and the networks' on every observed step while it is the
   * drawn product; see `showNetworks`. Their newest frames are fetched
   * whatever is drawn, for the picker's age.
   */
  private wholes: Record<WholeProduct, NetworkRadarLayer>;

  /**
   * DWD's column maximum, newest frame: drawn through DWD's own layer, on
   * HX's grid and with HX's holes, while it is the drawn product; see
   * `dwdFrame`. Fetched whatever is drawn, like the merged composite.
   */
  private dmax = new LatestFrame(fetchColumnMaximum);

  /**
   * The column maximum of every network around DMAX while DMAX is drawn, cut
   * to the networks' own ground; see `aroundFrame`. Handed the whole column
   * maximum's frames, never fetching its own.
   */
  private around: NetworkRadarLayer;

  /** The product the reader picked; see lib/observedProduct.ts. */
  private chosen: ObservedProduct = DEFAULT_PRODUCT;

  /** The product the map draws: the choice, or the default while it falls behind. */
  private drawn: ObservedProduct = DEFAULT_PRODUCT;

  /** Each product besides the default, by the newest frame it keeps. */
  private latest: Record<AlternativeProduct, { current(): RadarFrame | null }>;

  /** Which products' past the grid in hand was asked for with, as `productsKey` puts it; see `downloadCurrentRadar`. */
  private gridProducts = "";

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
      map, network, () => {
        this.notify("networks", this.liveNetworkFrames());
        // A country's new frame changes how old the products around it are.
        radarProducts.update((products) => ({ ...products, ranges: this.scanRanges(products.scans) }));
      },
    ));
    // Not an observer's business: the 3D map drapes HX and the networks
    // whatever the flat map draws.
    // Told by `refreshWhole` instead of on a new frame, because an answer of
    // none is news too: it can give a choice up (`givesUpChoice`).
    this.wholes = {
      merged: new NetworkRadarLayer(map, EUROPE),
      colmax: new NetworkRadarLayer(map, EUROPE_COLUMN_MAXIMUM),
    };
    this.around = new NetworkRadarLayer(map, AROUND_DMAX);
    this.latest = { ...this.wholes, dmax: this.dmax };
    this.unsubscribeProduct = observedProduct.subscribe((product) => {
      this.chosen = product;
      // Its past comes with the grid, asked for by name. Before the first
      // grid, the request in flight is checked when it lands instead.
      const wanted = productsKey(timeseriesProducts(this.chosen));
      if (this.serverGrid && wanted && wanted !== this.gridProducts) this.reloadRadar();
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
      for (const network of [...this.networks, ...Object.values(this.wholes), this.around]) network.setPalette(colorScheme);
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
      // DWD's grid only. The networks have their own event below; reloading
      // all four on every poke cost four requests every five minutes and
      // brought nothing new.
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
      // One network's composite, one of every network's, or DMAX was
      // re-rendered: refetch only that frame. These land every minute or two,
      // so they don't go through `poke`, which reloads DWD's whole timeseries.
      this.networkHandler = ({ network }) => {
        whenVisible(`radar:network:${network}`, () => {
          const whole = Object.values(this.wholes).find((layer) => layer.network.code === network);
          if (whole) {
            this.refreshWhole(whole);
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
        ...Object.values(this.wholes).map((whole) => this.refreshWhole(whole)),
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
      // The frame's value tiles. Everything keyed by URL (indices, holes,
      // prefetch) follows.
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
   * HTTP cache (and the service worker's) when OpenLayers asks.
   *
   * This only helps because the tiles are cacheable by URL (a tile_id names
   * one rendering). The bytes are the same either way; only the time they are
   * asked for changes.
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

    const ahead: number[] = [];
    for (let step = fromStep + STEP_SECONDS; step <= last && ahead.length < count; step += STEP_SECONDS) {
      ahead.push(step);
    }

    const urls: string[] = [];
    for (const step of ahead) {
      const frame = this.dwdFrame(step);
      if (!frame) break;
      const { tiles: index } = frame;
      const template = templateOf(frame.url);
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
    // Or a product of every network's, on the steps it stands in for them all.
    const wholes = ahead.map((step) => this.wholeFrame(step));
    const arounds = ahead.map((step) => this.aroundFrame(step));
    for (const network of this.networks) {
      const frames = ahead
        .filter((_step, i) => !wholes[i] && !arounds[i])
        .map((step) => this.networkGrid[network.network.code]?.[step])
        .filter((frame): frame is RadarFrame => Boolean(frame));
      if (frames.length) urls.push(...network.tileUrls(frames, PREFETCH_MAX_TILES));
    }
    for (const [product, layer] of Object.entries(this.wholes) as [WholeProduct, NetworkRadarLayer][]) {
      const frames = wholes.filter((whole) => whole?.product === product).map((whole) => whole!.frame);
      if (frames.length) urls.push(...layer.tileUrls(frames, PREFETCH_MAX_TILES));
    }
    const aroundFrames = arounds.filter((frame): frame is RadarFrame => Boolean(frame));
    if (aroundFrames.length) urls.push(...this.around.tileUrls(aroundFrames, PREFETCH_MAX_TILES));

    if (this.prefetched.size > PREFETCH_REMEMBERED) this.prefetched.clear();
    for (const url of urls) {
      if (this.prefetched.has(url)) continue;
      this.prefetched.add(url);
      // Same request the tile loader makes (CORS, no credentials), so the
      // cache entry is the one it will look for. The body is read to
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
   * it *on*. The grid that answers the refetch turns it off, so a slow
   * response cannot clear the warning before the data it warns about has
   * been replaced.
   */
  refreshStaleness() {
    if (!this.clientGrid) return;
    if (!isOutdated(this.getMostRecentObservation(), Date.now() / 1000, get(radarCadence))) return;
    radarStale.set(true);
    live.set(false);
  }

  /**
   * The radar layer's opacity, computed in one place from both reasons to dim.
   *
   * Staleness and the open popup both dim it and neither knows about the
   * other. If each set it directly, whichever fired last would win: closing a
   * popup over stale radar would restore it to full strength and drop the
   * outdated warning with it. Here both are flags and the opacity is computed
   * from them, so they combine. Stale radar being inspected is dimmer still,
   * and each is undone only by its own cause.
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
   * The radar of one observed step, for the 3D map to drape under that
   * scan's storms when the reader picks an earlier one: HX's frame, as the
   * live drape is (App.svelte), and each network's composite for the step
   * where the grid has one, whose `upstream_time` is that network's own
   * scan. Null for a step the grid has no observation for, which is any
   * older than its two hours.
   */
  observedAt(step: number): { url: string; tiles?: TileIndex | null; networks: Partial<Record<NetworkCode, RadarFrame>> } | null {
    const frame = this.clientGrid?.[step];
    if (!frame?.url || frame.source !== "observation") return null;
    const networks: Partial<Record<NetworkCode, RadarFrame>> = {};
    for (const code of ALL_NETWORKS) {
      const found = this.networkGrid[code]?.[step];
      if (found) networks[code] = found;
    }
    return { url: frame.url, tiles: frame.tiles, networks };
  }

  /**
   * The scans of the radar the live step shows on the 3D map: what a storm's
   * volume is judged against, and its "3D" tag on the flat map left off when
   * older. The same frames App.svelte drapes there, DWD's and each network's
   * own, whichever product the flat map draws.
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
    for (const whole of Object.values(this.wholes)) this.refreshWhole(whole);
    this.refreshColumnMaximum();
  }

  /** One of every network's products, newest frame, and whatever that changes (a frame or none). */
  private async refreshWhole(whole: NetworkRadarLayer) {
    await whole.refresh(this.nanobar);
    this.productsChanged();
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
      merged: this.latest.merged.current()?.upstream_time ?? null,
      colmax: this.latest.colmax.current()?.upstream_time ?? null,
      dmax: this.latest.dmax.current()?.upstream_time ?? null,
    };
  }

  /** The scans each product's picture is made of, for the picker (`scanRange`). */
  private scanRanges(scans: NewestScans): Record<ObservedProduct, ScanRange | null> {
    const networks = Object.values(this.liveNetworkFrames())
      .map((frame) => frame?.upstream_time)
      .filter((scan): scan is number => typeof scan === "number");
    // What DMAX would have around it on the live step, drawn or not: the
    // picker ages the option before it is picked.
    const around = fallsBehind("colmax", scans) ? null : scans.colmax;
    return {
      hx: scanRange("hx", scans.hx, networks, null),
      merged: scanRange("merged", scans.merged, networks, null),
      colmax: scanRange("colmax", scans.colmax, networks, null),
      dmax: scanRange("dmax", scans.dmax, networks, around),
    };
  }

  /**
   * Re-decide what the map draws after anything that can change it (the
   * reader's choice, or a new frame of any of the three products), tell the
   * picker, and put it on the step on screen.
   */
  private productsChanged() {
    const scans = this.newestScans();
    if (this.chosen === "merged" || this.chosen === "colmax") {
      if (givesUpChoice(this.chosen, scans, this.wholes[this.chosen].answered())) {
        this.giveUpChoice(this.chosen);
        return;
      }
    }
    this.drawn = drawnProduct(this.chosen, scans);
    radarProducts.set({ chosen: this.chosen, drawn: this.drawn, scans, ranges: this.scanRanges(scans) });
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
   * Switch the reader's choice to the default, saying so: one of the EU
   * products has no frame at all. The setting changes, so the map does not
   * flip back on the next frame, and the notice is raised this once; picking
   * the product again is the reader's to do. `productsChanged` runs again
   * from the setting's own subscription.
   */
  private giveUpChoice(product: "merged" | "colmax") {
    const t = get(_);
    reportToast(t("chrome.radar_product.gave_up", {
      values: { product: t(`chrome.radar_product.${product}`), fallback: t(`chrome.radar_product.${DEFAULT_PRODUCT}_option`) },
    }), "warning", "exclamation-triangle");
    // Before the setting, so nothing that runs in between gives it up twice.
    this.chosen = DEFAULT_PRODUCT;
    window.settings.set("radarProduct", DEFAULT_PRODUCT);
  }

  /** The `colmax` frame drawn around DMAX on a step, or null; see `aroundFrame`. */
  private aroundFrame(step: number): RadarFrame | null {
    const frame = this.clientGrid?.[step];
    return aroundFrame(
      this.drawn,
      { observed: frame?.source === "observation" && Boolean(frame.url), live: step === this.getMostRecentObservation(), key: step },
      this.productGrid.colmax,
      this.latest.colmax.current(),
      this.newestScans(),
    );
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
      this.latest[product].current(),
    );
  }

  /**
   * What DWD's layer draws on a step, by the name its holes are keyed by,
   * and which tiles that frame has: DMAX's frame there while it is the drawn
   * product and has one, else the grid's: HX's, or WN's on a forecast step.
   * Null where the grid has nothing yet.
   */
  private dwdFrame(step: number): { url: string; tiles?: TileIndex | null } | null {
    const frame = this.clientGrid?.[step];
    if (!frame?.url) return null;
    const dmax = this.alternativeFrame("dmax", step);
    if (dmax) {
      return { url: frameOnStep(tileSourceUrl("meteoradar", drawnTileId(dmax)), dmax.upstream_time, step), tiles: dmax.tiles };
    }
    return { url: frame.url, tiles: frame.tiles };
  }

  /**
   * DWD's grid alone. The networks are on their own cadence with their own
   * socket event, and nothing that changes the grid (a poke, a new sample
   * position, a palette) changes them.
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
   * those the grid has a composite for, and on the live one all of them,
   * since those layers bring their own newest frame there whatever the grid
   * says.
   */
  private holes(): globalThis.Map<string, NetworkCode[]> {
    const holes = new globalThis.Map<string, NetworkCode[]>();
    const newest = this.getMostRecentObservation();
    for (const [key, frame] of Object.entries(this.clientGrid ?? {})) {
      if (!frame?.url || frame.source !== "observation") continue;
      const step = parseInt(key, 10);
      // Around DMAX the column maximum stands where every network would.
      const codes = step === newest || this.aroundFrame(step)
        ? ALL_NETWORKS
        : ALL_NETWORKS.filter((code) => this.networkGrid[code]?.[step]);
      // By the name the step's frame is drawn under, which tells DMAX's
      // newest apart on the live step and on its own; see `frameOnStep`.
      if (codes.length) holes.set(this.dwdFrame(step)!.url, codes);
    }
    return holes;
  }

  /** The frame of every network's product drawn on a step, and which it is; null where none is. */
  private wholeFrame(step: number): { product: WholeProduct; frame: RadarFrame } | null {
    for (const product of WHOLE_PRODUCTS) {
      const frame = this.alternativeFrame(product, step);
      if (frame) return { product, frame };
    }
    return null;
  }

  /**
   * Point every network layer at the step on screen.
   *
   * On an observed step where a product of every network's is drawn, that
   * one frame stands in for all five networks while it is the drawn product.
   * DWD's layer and the networks' are hidden under it instead of blended with
   * it: every palette is partly transparent, and two drawn together read as a
   * third intensity.
   */
  private showNetworks(shown: number, live: boolean) {
    const whole = this.wholeFrame(shown);
    const around = whole ? null : this.aroundFrame(shown);
    const own = !whole && !around;
    for (const network of this.networks) {
      network.show(live && own, own ? this.networkGrid[network.network.code]?.[shown] ?? null : null);
    }
    this.around.show(false, around);
    // The frame itself, the live one included: `alternativeFrame` has
    // already judged the newest fresh.
    for (const product of WHOLE_PRODUCTS) {
      this.wholes[product].show(false, whole?.product === product ? whole.frame : null);
    }
    this.layer?.setVisible(!whole);
  }

  /**
   * Where the forecast is sampled: a tapped point, else the client's own,
   * along with the network the map draws there. The past half of the strip
   * is read from that network's composites.
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
    const products = timeseriesProducts(this.chosen);
    // Asked again without the products when that fails: an API that does not
    // know one yet (a client deployed before its backend) answers 422, and
    // without the retry the map would have no radar at all instead of HX
    // without that product.
    let asked = products;
    const data = await fetchRadarTimeseries(this.nanobar, this.getPosition(), products).catch(() => {
      if (!products.length) return null;
      asked = [];
      return fetchRadarTimeseries(this.nanobar, this.getPosition(), []).catch(() => null);
    });
    if (!data) {
      live.set(false);
      return;
    }
    /* A poke, a wake, a tap and the retries a bad network brings all send
       one of these, and they need not answer in order. A response older
       than one already applied would put the previous grid (or another
       point's forecast) back. */
    if (request < this.gridApplied) return;
    this.gridApplied = request;
    this.gridSampledAt = at;
    this.gridProducts = productsKey(asked);
    this.processRadar(data);
    if (forUser) dryAtUser.set(isDry(data.frames));
    // Picked while this was out: its past is still to be asked for. Against
    // what was asked for first, so a product the API refused is not asked
    // for again and again.
    const wanted = productsKey(timeseriesProducts(this.chosen));
    if (wanted && wanted !== productsKey(products)) this.reloadRadar();
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
   * newer than that. No observation ever is, so the loop was dead and the
   * function returned the server's clock under an observation's name. That
   * only worked because on production the step at server_time happens to BE
   * the newest observation. On a backend that publishes no observations at
   * all it silently returned a forecast step instead, and every caller that
   * looks the result up in the grid (resetToLatest, processRadar's first
   * layer, the scrubber's initial value) needs it to be a real step.
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
      // behind it is not either: same prefix rule as getLastPlayableStep().
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
   * clock advances while the radar does not, which looks like a freeze.
   *
   * Stops at the first hole instead of skipping it, like
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
    // Only the backend knows: a replay is built to look identical from here,
    // so nothing in the frames gives it away.
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
    // make sense on the live frame read it against the indicator (see the
    // cell layer's gate in App.svelte). On the live path `resetToLatest` has
    // already said this and the write is a no-op; on a manual scrubber it is
    // the one that matters, and it leaves the indicator where the reader put
    // it, now measurably behind.
    setFrames({ newest: this.getMostRecentObservation() });
    // A new grid can carry composites for the step on screen that the last
    // one did not, without the indicator moving to say so. It also carries
    // HX's newest scan, which the other products are measured against.
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
   * Cheap enough to do on every grid (a couple of dozen numbers). Doing it
   * here instead of in the panel means the prediction exists whether or not
   * anyone has the diagnostics open, which the degraded criteria need.
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
    for (const whole of Object.values(this.wholes)) whole.destroy();
    this.around.destroy();
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
