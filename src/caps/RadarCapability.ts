import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Style } from "ol/style";
import snow from "../assets/snow.png";
import { dwdValueLayer, setDwdCmap, tileSourceUrl } from "../layers/dwd";
import type { RadarDrawing } from "../layers/radarDrawing";
import { radarFrames } from "../layers/radarFrames";
import { decodedTiles, frameOnStep, heldOnScreen, loadStoredTile, tileReady } from "../layers/valueTiles";
import type ValueTileSource from "../layers/valueTiles";
import type { TileJob } from "../layers/valueTiles";
import { ENTRY_OVERHEAD, costOf } from "../lib/decodedTiles";
import { decodeAheadParallel } from "../lib/gpuBudget";
import { getForViewAndSize, getIntersection, isEmpty } from "ol/extent";
import NetworkRadarLayer, {
  AROUND_DMAX, EUROPE, EUROPE_COLUMN_MAXIMUM, EUROPE_ECHO_TOP_18, EUROPE_ECHO_TOP_45, EUROPE_ECHO_TOP_50, EUROPE_VIL, NETWORKS,
  NOWCAST_NETWORKS,
} from "../layers/network";
import LatestFrame from "../layers/latestFrame";
import { networkAt } from "../layers/networkAt";
import { ALL_NETWORKS } from "../layers/networkHoles";
import type { NetworkCode } from "../layers/networkHoles";
import type { TileIndex } from "../lib/tileIndex";
import { RVP6_ENCODING, drawnTileId, encodingOf } from "../lib/rvp6";
import type { Ink, ValueTiles } from "../lib/rvp6";
import { isDarkBasemap } from "../layers/casing";
import type { RadarFrame, TimeseriesProduct } from "../api";
import type { CountryNetwork } from "../api/events";
import type { RadarScans } from "../lib/scans";
import {
  capDescription,
  capLatestObservation,
  capLastUpdated,
  capTimeIndicator,
  compositeDim,
  drawnEncoding,
  dryAtUser,
  lastFocus,
  inspectLatLon,
  latLon,
  live,
  mapBaseLayer,
  radarCadence,
  radarColorScheme,
  radarStale,
  replay,
  selectedStorm,
  setFrames,
  showForecastPlaybutton, snowLayerVisible, zoomlevel,
  observedProduct,
  radarProducts,
  nowcastCoverage,
  framesPreloaded,
  archiveWindow,
  playbackRunning,
  radarCrossfade,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions, RadarSocket } from "./options";
import { isDry } from "../lib/dryness";
import Capability from "./Capability";
import { tileBaseUrl } from "../urls";
import { NothingPublished, Refused, fetchColumnMaximum, fetchRadarTimeseries, fetchSnowOverlay } from "../api";
import { EMPTY_CADENCE } from "../lib/updateCadence";
import { sameWindow, windowSteps } from "../lib/archive";
import type { ArchiveWindow } from "../lib/archive";
import { publishCadence } from "../lib/updateCadence";
import { isOutdated, showsLatestFrame } from "../lib/freshness";
import { lastPublishedStep, newestObservation } from "../lib/timeline";
import {
  DEFAULT_PRODUCT, OBSERVED_PRODUCTS, WHOLE_PRODUCTS, aroundFrame, drawnProduct, fallsBehind, givesUpChoice, isWholeProduct,
  scanRange, stepFrame, timeseriesProducts,
} from "../lib/observedProduct";
import type {
  AlternativeProduct, NewestScans, ObservedProduct, ScanRange, WholeProduct,
} from "../lib/observedProduct";
import {
  NOWCAST_PRODUCT, chartFrames, domainsAt, domainsWithRun, lastStepWithRuns, nowcastRuns,
} from "../lib/nowcast";
import type { NowcastRuns } from "../lib/nowcast";
import { NOWCAST_OPACITY } from "../layers/ui";
import { whenVisible } from "../lib/wakeup";
import { FramePreloader, preloadOrder } from "../lib/framePreload";
import { derived, get } from "svelte/store";
import { _ } from "svelte-i18n";
import { reportToast } from "../lib/Toast";
//import { MeteoTileCache, mcTileCache } from "../lib/TileCache";

const DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL = 12;

/** How long the step on screen has to rest in a past window before its snow is asked for. */
const SNOW_AT_DEBOUNCE_MS = 300;

/** The most tiles one layer of one frame is preloaded with: a desktop viewport's. */
const PRELOAD_MAX_TILES = 48;

/**
 * How much of the decoded tiles' room a plan may take: the rest is for the
 * tiles the layers load on their own, the frame on screen among them.
 */
const PLANNED_SHARE = 0.8;

/**
 * What to decode ahead (`RadarCapability.preloadTimeline`): with `ahead`,
 * only that many frames after the one given; with `order`, the steps in the
 * order playback will show them, the one given first.
 */
export interface PreloadOptions {
  ahead?: number;
  order?: readonly number[];
}

/**
 * What a tile will hold once decoded: what it does, if it is; else what the
 * tiles held cost on average, or until that is known, a whole packed tile.
 */
function expectedBytes(job: TileJob): number {
  const kept = decodedTiles.peek(job.key);
  if (kept !== undefined) return costOf(kept);
  return decodedTiles.meanCost() ?? ENTRY_OVERHEAD + job.size * job.size;
}

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
const productsKey = (products: readonly TimeseriesProduct[]): string => products.join(",");

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
  /** Reflectivity at the point; null where nothing forecasts it (lib/nowcast.ts `chartFrames`). */
  dbz: number | null;
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

/**
 * The five-minute grid the playback slider scrubs across: ±2h of now, or a
 * past window's steps (lib/archive.ts), whose "now" is its end.
 */
export interface GridConfig {
  grid: Record<number, GridStep>;
  start: number;
  end: number;
  now: number;
  length: number;
  /** The past window the grid is of, or null for the live one. */
  window: ArchiveWindow | null;
}

export default class RadarCapability extends Capability {
  /** How DWD's frames are drawn, built with the first grid. */
  layer: RadarDrawing | null;

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
   * The products of every network at once (the merged composite of their
   * lowest tilts, their column maximum, and the echo tops and VIL its pass
   * reads up the column), each drawn whole in place of DWD's frame and the
   * networks' on every observed step while it is the drawn product; see
   * `showNetworks`. Their newest frames are fetched whatever is drawn, for
   * the picker's age.
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

  /**
   * Each network's run of meteocool's own nowcast, drawn on the forecast
   * steps it has a lead for: one layer per network, cut to its ground, with WN holed for it on those steps
   * (`holes`). Handed the run's frames, never fetching. See lib/nowcast.ts.
   */
  private nowcasts: NetworkRadarLayer[];

  /** Each network's run, from the same response as the grid. */
  private nowcastGrid: NowcastRuns<RadarFrame> = {};

  /** The network the grid in hand was sampled for, whose run the chart's forecast bars come from. */
  private gridNetwork: CountryNetwork | null = null;


  /** Mirror of the radarStale store, so the layer can be dimmed without a get(). */
  stale: boolean;

  /** Whether a cell's popup is open, which is the other reason to dim it. */
  private inspecting = false;

  /** How strongly the composites are drawn: dimmed while site mode is open (`compositeDim`). */
  private dim = 1;

  private nanobar: NanobarWrapper;

  private socket_io?: RadarSocket;

  /** Kept so destroy() can take these back off the socket again. */
  private pokeHandler: (() => void) | null = null;

  private snowHandler: (() => void) | null = null;

  private networkHandler: ((event: { network: string }) => void) | null = null;

  private nowcastHandler: (() => void) | null = null;

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
   * The past window the map is open in (`archiveWindow`), or null for live.
   * While one is open the grid is its steps, fetched with `start` and `end`,
   * and nothing about now moves it: no minute's regeneration, no socket
   * event, no return to the newest frame.
   */
  private past: ArchiveWindow | null = null;

  /** Numbers each past snowfield request, so an answer for a step left behind is dropped. */
  private snowAsked = 0;

  private snowAtTimer: number | undefined;

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
      echotop18: new NetworkRadarLayer(map, EUROPE_ECHO_TOP_18),
      echotop45: new NetworkRadarLayer(map, EUROPE_ECHO_TOP_45),
      echotop50: new NetworkRadarLayer(map, EUROPE_ECHO_TOP_50),
      vil: new NetworkRadarLayer(map, EUROPE_VIL),
    };
    this.around = new NetworkRadarLayer(map, AROUND_DMAX);
    this.nowcasts = NOWCAST_NETWORKS.map((network) => new NetworkRadarLayer(map, network));
    this.latest = { ...this.wholes, dmax: this.dmax };
    this.unsubscribeProduct = observedProduct.subscribe((product) => {
      this.chosen = product;
      // Its past comes with the grid, asked for by name. Before the first
      // grid, the request in flight is checked when it lands instead.
      const wanted = productsKey(this.timeseriesRequest());
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
    /* Under an open radar's own sweep the composites are dimmed
       (`compositeDim`) and drawn in grey, so their colours do not mix with
       the sweep's: black ink on a light basemap, white on a dark one. */
    derived(
      [radarColorScheme, compositeDim, mapBaseLayer],
      ([colorScheme, dim, basemap]) => {
        const ink: Ink | null = dim < 1 ? (isDarkBasemap(String(basemap)) ? "white" : "black") : null;
        return [colorScheme, ink] as const;
      },
    ).subscribe(([colorScheme, ink]) => {
      // Every radar layer's palette is its style (lib/rvp6.ts): restyled in
      // place, with nothing reloaded and the grid neither refetched nor
      // re-announced.
      setDwdCmap(colorScheme, ink);
      for (const network of [...this.networks, ...Object.values(this.wholes), this.around, ...this.nowcasts]) {
        network.setPalette(colorScheme, ink);
      }
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
          // A past window has no chart: where the reader is changes nothing in it.
          if (!this.past) this.reloadRadar();
        }
      } else {
        this.latlon = latlonUpdate;
        if (!this.past) this.reloadRadar();
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
      if (!this.past) this.reloadRadar();
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
      // A past window is not overtaken by the clock: a wake asks for it again,
      // in case what was asked before the sleep never came back.
      if (this.past) {
        this.reloadRadar();
        this.downloadSnowAt(get(capTimeIndicator));
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

    /* Each step of playback fades from the one before where the frame layer
       draws the radar (layers/radarFrames.ts), unless the reader turned it
       off; a frame picked by hand is cut to. */
    derived([playbackRunning, radarCrossfade], ([playing, crossfade]) => playing && crossfade)
      .subscribe((fading) => radarFrames(map)?.setCrossfade(fading));

    /* Site mode draws one radar's own sweep over the composites, and dims
       them so the one does not drown in the other; the networks' layers
       follow the same store (layers/network.ts). */
    compositeDim.subscribe((value) => {
      this.dim = value;
      this.applyRadarOpacity();
    });

    /* The popup carries the cell's forecast onto the map with it, which is
       what needs the room; there is nothing to make room for once it closes. */
    selectedStorm.subscribe((storm) => {
      const open = storm !== null;
      if (open === this.inspecting) return;
      this.inspecting = open;
      this.applyRadarOpacity();
    });

    // Live, the snowfields are the newest and only drawn on the live frame;
    // in a past window, the step's own, on every step.
    live.subscribe((value) => {
      if (this.snowOverlay) {
        this.snowOverlay.setVisible(value || this.past !== null);
      }
    });

    snowLayerVisible.subscribe((value) => {
      if (value) {
        this.snowRequest = this.past ? Promise.resolve(this.downloadSnowAt(get(capTimeIndicator))) : this.downloadSnowOverlay();
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
      // Socket events announce the live sky: a past window ignores them until
      // it is left, which fetches everything anew.
      this.pokeHandler = () => {
        if (this.past) return;
        whenVisible("radar:poke", () => {
          console.log("received websocket poke, refreshing tiles + forecasts");
          this.reloadRadar();
        });
      };
      this.snowHandler = () => {
        if (this.past) return;
        whenVisible("radar:snow", () => {
          console.log("received websocket snow overlay poke, refreshing");
          this.downloadSnowOverlay();
        });
      };
      // One network's composite, one of every network's, or DMAX was
      // re-rendered: refetch only that frame. These land every minute or two,
      // so they don't go through `poke`, which reloads DWD's whole timeseries.
      this.networkHandler = ({ network }) => {
        if (this.past) return;
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
      // One network's nowcast run is complete: the timeseries again, which
      // carries every network's newest run, and with it the forecast layers
      // re-pointed. One key for every network: four runs landing while the page is hidden
      // are one refetch when it is looked at.
      this.nowcastHandler = () => {
        if (this.past) return;
        whenVisible("radar:nowcast", () => {
          console.log("received websocket nowcast, refreshing the forecast");
          this.reloadRadar();
        });
      };
      this.socket_io.on("poke", this.pokeHandler);
      this.socket_io.on("snow", this.snowHandler);
      this.socket_io.on("network", this.networkHandler);
      this.socket_io.on("nowcast", this.nowcastHandler);
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
      // A past window does not slide with the clock.
      if (this.past) return;
      this.gridconfig = this.regenerateGridConfig();
      if (this.serverGrid) {
        this.updateClientGridFromServerGrid(this.serverGrid);
        this.notify("grid", this.clientGridConfig);
      }
    };
    // A screenshot is taken and closed long before the grid moves on.
    if (!options.screenshot) restartHandler();

    /* A past window opened, changed or left: the grid is rebuilt for it and
       asked for. The store's first call, live, is construction. */
    archiveWindow.subscribe((next) => {
      if (sameWindow(next, this.past)) return;
      if (next) this.enterWindow(next);
      else this.leaveWindow();
    });
    /* In a window, the snowfields of the step on screen, once it rests. */
    capTimeIndicator.subscribe((shown) => {
      if (!this.past) return;
      window.clearTimeout(this.snowAtTimer);
      this.snowAtTimer = window.setTimeout(() => this.downloadSnowAt(shown), SNOW_AT_DEBOUNCE_MS);
    });
  }

  /**
   * Open the map in a past window: its grid, from the window's own steps,
   * asked for at once; the player follows nothing, and nothing judges the
   * frames against the clock, which a past window is always behind.
   */
  private enterWindow(next: ArchiveWindow) {
    this.past = next;
    this.trackingMode = "manual";
    live.set(false);
    radarStale.set(false);
    // Nothing is due in a past window: the degraded criteria's overdue
    // publish would count the live grid's lateness for as long as it is open.
    radarCadence.set(EMPTY_CADENCE);
    this.nowcastGrid = {};
    this.gridconfig = this.regenerateGridConfig();
    this.reloadRadar();
    this.snowOverlay?.setVisible(true);
  }

  /** Back to live: the live grid asked for anew, which puts the player back on the newest frame. */
  private leaveWindow() {
    this.past = null;
    window.clearTimeout(this.snowAtTimer);
    this.snowAsked += 1;
    this.trackingMode = "live";
    this.gridconfig = this.regenerateGridConfig();
    this.reloadAll();
    this.snowOverlay?.setVisible(get(live));
    this.snowRequest = this.downloadSnowOverlay();
  }

  /** The past window the map is open in, or null for live. */
  get pastWindow(): ArchiveWindow | null {
    return this.past;
  }

  updateClientGridFromServerGrid(frames) {
    let latestRadar = new Date(0);
    const body = { ...this.gridconfig.grid };
    // Untyped, as the grid's steps are: the frame is decorated into a GridStep below.
    const server: Record<string, any> = this.chartSeries(frames);

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
      // preload) follows.
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

  /**
   * Decodes the timeline's frames ahead for the map in view, into the tiles
   * every value layer's loader answers from; see lib/framePreload.ts.
   */
  private preloader = new FramePreloader(
    (key) => {
      const job = this.plannedJobs.get(key);
      return job ? loadStoredTile(job).then(() => true) : Promise.resolve(false);
    },
    (progress) => framesPreloaded.set(progress),
    {
      mayFetch: () => document.visibilityState !== "hidden",
      parallel: decodeAheadParallel(),
      reportEvery: 100,
      has: (key) => {
        const job = this.plannedJobs.get(key);
        return job ? tileReady(job) : decodedTiles.has(key);
      },
      // A plan cut short by what its tiles were expected to cost may reach
      // further once they are decoded and turn out to cost less.
      onIdle: () => {
        if (this.planCut) this.preloadTimeline(this.planCut.from, { ...this.planCut.options, onlyFurther: true });
      },
    },
  );

  /** What the plan in hand was made from, when it stopped short of the timeline's end; see `preloadTimeline`. */
  private planCut: { from: number; options: PreloadOptions } | null = null;

  /** How many frames the plan in hand reaches. */
  private planReach = 0;

  /** The tiles of the plan in hand, by key, for the preloader to load. */
  private plannedJobs = new globalThis.Map<string, TileJob>();

  /**
   * The tiles one step needs where the map is looking, at its zoom, as each
   * layer that draws on it will ask its loader for them: DWD's, each
   * network's (its newest frame on the live step), or a product of all of
   * theirs; each network's nowcast on a forecast step it has a lead for. The
   * same choices `showNetworks` makes. Null while the map has no size to
   * look with.
   */
  private stepJobs(step: number): TileJob[] | null {
    const { source } = this;
    const size = this.map.getSize();
    const { center, resolution, rotation } = this.map.getView().getState();
    if (!source || !this.clientGrid || !size || resolution === undefined) return null;
    // What the map draws: the whole of it, about its middle. `calculateExtent`
    // centres the size on the View's centre, which the tray's padding moves,
    // and missed the tiles under the tray.
    const viewExtent = getForViewAndSize(center, resolution, rotation, size);

    const jobs: TileJob[] = [];
    const whole = this.wholeFrame(step);
    const around = whole ? null : this.aroundFrame(step);
    // A missed scan: nothing to load, but the frames after it still play.
    const frame = whole ? null : this.dwdFrame(step);
    if (frame) {
      // Only what the layer draws: nothing outside DWD's grid is asked for.
      const layerExtent = this.layer?.getExtent();
      const extent = layerExtent ? getIntersection(viewExtent, layerExtent) : viewExtent;
      if (!isEmpty(extent)) jobs.push(...source.tileJobs(frame.url, frame.tiles, extent, resolution, PRELOAD_MAX_TILES));
    }
    // Over the networks' countries DWD's tiles are holes: their own frames,
    // or a product of all of theirs on the steps it stands in for them.
    if (whole) jobs.push(...this.wholes[whole.product].tileJobs(whole.frame, viewExtent, resolution, PRELOAD_MAX_TILES));
    else if (around) jobs.push(...this.around.tileJobs(around, viewExtent, resolution, PRELOAD_MAX_TILES));
    else {
      const live = !this.past && showsLatestFrame(step, this.getMostRecentObservation());
      for (const network of this.networks) {
        const own = live ? network.current() : this.networkGrid[network.network.code]?.[step];
        if (own) jobs.push(...network.tileJobs(own, viewExtent, resolution, PRELOAD_MAX_TILES));
      }
    }
    // Each network's nowcast on a forecast step it has a lead for: WN's tiles are holes there.
    const domains = this.nowcastDomainsAt(step);
    for (const layer of this.nowcasts) {
      const code = layer.network.code as CountryNetwork;
      if (domains.includes(code)) {
        jobs.push(...layer.tileJobs(this.nowcastGrid[code]![step], viewExtent, resolution, PRELOAD_MAX_TILES));
      }
    }
    return jobs;
  }

  /** The keys of the tiles a step needs that are not ready to draw at once (`tileReady`); null while the map cannot say. */
  private stepMissing(step: number): string[] | null {
    const jobs = this.stepJobs(step);
    return jobs && [...new Set(jobs.filter((job) => !tileReady(job)).map((job) => job.key))];
  }

  /**
   * Decode the tiles of every frame the timeline can show, for the map in
   * view, nearest `from` first, or in the `order` playback shows them; or,
   * with `ahead`, only that many frames after it, which is what a reader
   * saving data gets during playback.
   *
   * Scrubbed through or played, a frame whose tiles are asked for only when
   * it is shown is blocky or half-drawn for the first few hundred
   * milliseconds. Decoded here, a layer's loader answers from them at once
   * (`loadStoredTile`). Only as many frames as the decoded tiles can hold
   * are planned (`decodedTileBytes`), nearest first, and those are kept over
   * any others: past that, a phone would decode the next frame only to let
   * it go for the one after. A tile not yet decoded is reckoned at what
   * those held cost on average, and a plan cut short is tried again once
   * loaded (`onlyFurther`), taken only if it then reaches further. How far
   * each frame has got is `framesPreloaded`.
   */
  preloadTimeline(from: number, { ahead, order: played, onlyFurther = false }: PreloadOptions & { onlyFurther?: boolean } = {}) {
    if (!this.clientGrid) return;
    const last = this.getLastPlayableStep();
    const steps = Object.keys(this.clientGrid).map(Number).filter((step) => step <= last).sort((a, b) => a - b);
    const known = new Set(steps);
    // Playing, the steps in the order the loop shows them; else nearest the needle.
    const around = played ? played.filter((step) => known.has(step)) : preloadOrder(steps, from);
    const order = ahead === undefined ? around
      : played ? around.slice(0, ahead + 1) : steps.filter((step) => step > from).slice(0, ahead);
    const needs: Array<[number, string[]]> = [];
    const jobs = new globalThis.Map<string, TileJob>();
    let bytes = 0;
    let cut = false;
    for (const step of order) {
      const stepJobs = this.stepJobs(step);
      if (!stepJobs) return;
      const fresh = stepJobs.filter((job) => !job.local && !jobs.has(job.key));
      // A tile already on the GPU is not decoded again, and costs the store nothing.
      const cost = fresh.reduce((sum, job) => sum + (heldOnScreen(job) ? 0 : expectedBytes(job)), 0);
      // Always the next couple of frames, whatever they cost.
      if (needs.length >= 2 && bytes + cost > decodedTiles.capacity * PLANNED_SHARE) {
        cut = true;
        break;
      }
      bytes += cost;
      for (const job of fresh) jobs.set(job.key, job);
      needs.push([step, [...new Set(stepJobs.filter((job) => !job.local).map((job) => job.key))]]);
    }
    // Tried again once this plan is loaded, and taken only where it reaches further.
    if (onlyFurther && needs.length <= this.planReach) return;
    this.planCut = cut ? { from, options: { ahead, order: played } } : null;
    this.planReach = needs.length;
    this.plannedJobs = jobs;
    decodedTiles.retain(jobs.keys());
    radarFrames(this.map)?.retain(jobs.keys());
    this.preloader.plan(needs);
  }

  /** No more frames decoded ahead, and none shown as decoded. */
  stopPreload() {
    this.planCut = null;
    this.planReach = 0;
    this.preloader.stop();
    this.plannedJobs = new globalThis.Map();
    decodedTiles.retain([]);
    radarFrames(this.map)?.retain([]);
    radarFrames(this.map)?.setUpcoming([]);
  }

  /**
   * The steps playback shows next, the nearest first: where the frame layer
   * draws the radar, their tiles are uploaded as they are decoded, so that
   * moving onto them uploads nothing (layers/radarFrames.ts `setUpcoming`).
   * None, once nothing plays.
   */
  prepareSteps(steps: readonly number[]) {
    const frames = radarFrames(this.map);
    if (!frames) return;
    frames.setUpcoming(steps.flatMap((step) => this.stepJobs(step) ?? []));
  }

  /**
   * Whether every tile `step` needs for the map in view is ready to draw
   * (`tileReady`: decoded, or still on the GPU), so that putting it on
   * screen draws it whole at once. True while the map cannot say, which
   * nothing would come of waiting for.
   */
  stepReady(step: number): boolean {
    return !this.stepMissing(step)?.length;
  }

  /**
   * Resolves true once every tile `step` needs for the map in view is
   * ready to draw, or false after `timeoutMs` or once `signal` aborts.
   * Playback holds the frame on screen for it (lib/playbackGate.ts).
   */
  whenStepReady(step: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const missing = this.stepMissing(step);
    return missing ? decodedTiles.whenAll(missing, timeoutMs, signal) : Promise.resolve(true);
  }

  regenerateGridConfig(): GridConfig {
    if (this.past) {
      const steps = windowSteps(this.past);
      const grid: Record<number, GridStep> = {};
      for (const step of steps) grid[step] = { dbz: 0, url: null, tile_id: "", source: "" };
      return {
        grid, start: this.past.start, end: this.past.end, now: this.past.end, length: steps.length, window: this.past,
      };
    }
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
      grid, start, end, now: gridNow, length: nSteps, window: null,
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
    if (!this.clientGrid || this.past) return;
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
    const base = (this.stale ? STALE_OPACITY : NOWCAST_OPACITY) * this.dim;
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
   * volume is judged against, and its "3D" tag on the flat map greyed when
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
    // Every other product's newest frame is the live step's, which a past window does not have.
    if (this.past) return;
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
    const scans = { hx: newest?.url && newest.source === "observation" ? (newest.upstream_time ?? step) : null } as NewestScans;
    for (const product of OBSERVED_PRODUCTS) {
      if (product !== DEFAULT_PRODUCT) scans[product] = this.latest[product].current()?.upstream_time ?? null;
    }
    return scans;
  }

  /** The scans each product's picture is made of, for the picker (`scanRange`). */
  private scanRanges(scans: NewestScans): Record<ObservedProduct, ScanRange | null> {
    const networks = Object.values(this.liveNetworkFrames())
      .map((frame) => frame?.upstream_time)
      .filter((scan): scan is number => typeof scan === "number");
    // What DMAX would have around it on the live step, drawn or not: the
    // picker ages the option before it is picked.
    const around = fallsBehind("colmax", scans) ? null : scans.colmax;
    const ranges = {} as Record<ObservedProduct, ScanRange | null>;
    for (const product of OBSERVED_PRODUCTS) {
      ranges[product] = scanRange(product, scans[product], networks, product === "dmax" ? around : null);
    }
    return ranges;
  }

  /**
   * Re-decide what the map draws after anything that can change it (the
   * reader's choice, or a new frame of any of the products), tell the
   * picker, and put it on the step on screen.
   */
  private productsChanged() {
    const scans = this.newestScans();
    // A past window is not judged by what is newest now: the choice is drawn
    // on every step it has a frame for, and the default on the others.
    if (!this.past && isWholeProduct(this.chosen) && givesUpChoice(this.chosen, scans, this.wholes[this.chosen].answered())) {
      this.giveUpChoice(this.chosen);
      return;
    }
    this.drawn = this.past ? this.chosen : drawnProduct(this.chosen, scans);
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

  /** Whether a step is the live one, whose frames are each product's own newest: never in a past window. */
  private isLiveStep(step: number): boolean {
    return !this.past && step === this.getMostRecentObservation();
  }

  /**
   * Switch the reader's choice to the default, saying so: one of the EU
   * products has no frame at all. The setting changes, so the map does not
   * flip back on the next frame, and the notice is raised this once; picking
   * the product again is the reader's to do. `productsChanged` runs again
   * from the setting's own subscription.
   */
  private giveUpChoice(product: WholeProduct) {
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
      { observed: frame?.source === "observation" && Boolean(frame.url), live: this.isLiveStep(step), key: step },
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
      { observed: frame?.source === "observation" && Boolean(frame.url), live: this.isLiveStep(step), key: step },
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
      if (!frame?.url) continue;
      const step = parseInt(key, 10);
      if (frame.source !== "observation") {
        // A forecast step is WN's, holed for each network whose nowcast has
        // a lead there: WN cut to DWD's own ground, as HX is for the
        // networks' composites.
        const runs = this.nowcastDomainsAt(step);
        if (runs.length) holes.set(frame.url, runs);
        continue;
      }
      // Around DMAX the column maximum stands where every network would.
      const codes = (!this.past && step === newest) || this.aroundFrame(step)
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
   * one frame stands in for all sixteen networks while it is the drawn product.
   * DWD's layer and the networks' are hidden under it instead of blended with
   * it: every palette is partly transparent, and two drawn together read as a
   * third intensity.
   */
  private showNetworks(shown: number, onLiveFrame: boolean) {
    // In a past window every step is the grid's, its end included.
    const live = onLiveFrame && !this.past;
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
    // What the legend reads the step in: an echo top's or VIL's own unit
    // while one is drawn, dBZ everywhere else.
    drawnEncoding.set(whole ? encodingOf(whole.frame) : RVP6_ENCODING);
    this.showNowcasts(shown);
  }

  /**
   * Point each network's nowcast layer at the step on screen: its run's lead
   * there, on a forecast step it has one for, and nothing anywhere else.
   * Says where the nowcast draws, for the wash and the player.
   */
  private showNowcasts(shown: number) {
    const domains = this.nowcastDomainsAt(shown);
    for (const layer of this.nowcasts) {
      const code = layer.network.code as CountryNetwork;
      layer.show(false, domains.includes(code) ? this.nowcastGrid[code]![shown] : null);
    }
    const coverage = { withRun: domainsWithRun(this.nowcastGrid), shown: domains };
    const before = get(nowcastCoverage);
    // A write only when it changed: the wash and the player recompute coverage on every one.
    if (JSON.stringify(before) !== JSON.stringify(coverage)) nowcastCoverage.set(coverage);
  }

  /**
   * The networks whose nowcast draws on a step: on a forecast step, those with a lead valid there (lib/nowcast.ts). Never an
   * observed step, where the networks' own composites are, though a run
   * from a network that is a scan behind DWD can have a lead on one.
   */
  private nowcastDomainsAt(step: number): CountryNetwork[] {
    const frame = this.clientGrid?.[step];
    if (!frame?.url || frame.source === "observation") return [];
    return domainsAt(this.nowcastGrid, step);
  }

  /**
   * The series the chart is drawn from: the timeseries' frames, with the
   * forecast steps' readings from the nowcast run of the network the point
   * is in, where that network has one; see
   * `chartFrames`. Over DWD's own ground, WN's, as ever.
   */
  private chartSeries<F extends { source: string; dbz?: number | null }>(
    frames: Record<string, F | null>,
  ): Record<string, F | null> {
    if (!this.gridNetwork) return frames;
    return chartFrames(frames, this.nowcastGrid[this.gridNetwork]);
  }

  /** What the timeseries is asked for with: the chosen product's past, and the nowcast runs. */
  private timeseriesRequest(): TimeseriesProduct[] {
    const products: TimeseriesProduct[] = timeseriesProducts(this.chosen);
    // A past window has observed steps only.
    return this.past ? products : [...products, NOWCAST_PRODUCT];
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
    // A past window has no chart, so nothing it shows is about a point.
    return this.past !== null || this.gridSampledAt === this.positionKey();
  }

  async downloadCurrentRadar() {
    // Taken with the position, before the round trip: a point tapped while the
    // request is out must not have the answer for the client's own position
    // read as the answer for it, or the other way round.
    // A past window is asked for by its steps alone: no chart, so no point.
    const past = this.past;
    const forUser = !past && this.inspectLatlon === null && this.latlon !== null;
    const at = this.positionKey();
    this.gridRequests += 1;
    const request = this.gridRequests;
    const products = this.timeseriesRequest();
    const position = past ? undefined : this.getPosition();
    // Asked again without the products when that fails: an API that does not
    // know one yet (a client deployed before its backend) answers 422, and
    // without the retry the map would have no radar at all instead of HX
    // without that product.
    let asked = products;
    // A past window the backend refuses (a 4xx: outside what it keeps, say)
    // is left, back to live, as the apps leave it, rather than kept empty.
    let refused = false;
    const data = await fetchRadarTimeseries(this.nanobar, position, products, past ?? undefined).catch((error) => {
      if (past && error instanceof Refused && error.status !== undefined && error.status >= 400 && error.status < 500) {
        refused = true;
        return null;
      }
      if (!products.length) return null;
      asked = [];
      return fetchRadarTimeseries(this.nanobar, position, [], past ?? undefined).catch(() => null);
    });
    // Asked for another window, or for live, than the map is in now.
    if (!sameWindow(past, this.past)) return;
    if (refused) {
      reportToast(get(_)("chrome.archive.refused"), "warning", "exclamation-triangle");
      archiveWindow.set(null);
      return;
    }
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
    this.gridNetwork = position?.network ?? null;
    this.processRadar(data);
    if (forUser) dryAtUser.set(isDry(this.chartSeries(data.frames)));
    // Picked while this was out: its past is still to be asked for. Against
    // what was asked for first, so a product the API refused is not asked
    // for again and again.
    const wanted = productsKey(this.timeseriesRequest());
    if (wanted && wanted !== productsKey(products)) this.reloadRadar();
  }

  /**
   * In a past window, the snowfields drawn from the precipitation types
   * measured at or before `at`, within ten minutes; none where there are
   * none then, which a 404 says.
   */
  async downloadSnowAt(at: number) {
    if (!this.past || !at || !get(snowLayerVisible)) return;
    this.snowAsked += 1;
    const asked = this.snowAsked;
    const data = await fetchSnowOverlay(this.nanobar, at).catch((error) => (
      error instanceof NothingPublished ? { active: false } : null));
    if (!data || asked !== this.snowAsked || !this.past) return;
    this.processSnowOverlay(data);
  }

  async downloadSnowOverlay() {
    if (!get(snowLayerVisible) || this.past) return;
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
   * Preference order, and the missed scans it skips: `newestObservation` in
   * lib/timeline.ts.
   */
  getMostRecentObservation(): number {
    // A past window's "now" is its end: its newest observation, or the end itself.
    return newestObservation(this.clientGrid, this.past ? this.past.end : this.serverTime);
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
   * A missed scan before it is played through on the frame before it: see
   * `lastPublishedStep` in lib/timeline.ts. With meteocool's nowcast on, held
   * back to where the networks' runs end while they catch up with WN: see
   * `lastStepWithRuns` in lib/nowcast.ts.
   */
  getLastPlayableStep(): number {
    return lastStepWithRuns(lastPublishedStep(this.clientGrid, this.gridconfig.end), this.nowcastGrid);
  }

  processRadar(obj) {
    if (!obj) return;

    this.serverGrid = obj.frames;
    this.networkGrid = obj.networks ?? {};
    this.productGrid = obj.products ?? {};
    this.nowcastGrid = nowcastRuns<RadarFrame>(obj.products);
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
        [this.layer, this.source] = dwdValueLayer(this.map, last);
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
    // A past window's frames say nothing of how current the radar is.
    if (!this.past) {
      capLastUpdated.set(latestRadar);
      this.publishCadenceFromGrid();
    }
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
    // A past window has no newest frame to follow; leaving it is what returns to live.
    if (this.past) return;
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
      // Following again, or the next grid leaves the map on this frame and the
      // next scrub, already "manual", never says it has left live.
      this.trackingMode = "live";
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
    // A past window's end is its "now", but never live.
    if (timestep === this.gridconfig.now && !this.past) {
      this.trackingMode = "live";
      live.set(true);
    }
    setFrames({ shown: timestep });
    const frame = this.dwdFrame(timestep);
    if (frame) this.source.setUrl(frame.url);
  }

  destroy() {
    window.clearTimeout(this.snowAtTimer);
    for (const network of this.networks) network.destroy();
    for (const whole of Object.values(this.wholes)) whole.destroy();
    this.around.destroy();
    for (const nowcast of this.nowcasts) nowcast.destroy();
    nowcastCoverage.set(null);
    drawnEncoding.set(RVP6_ENCODING);
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
      if (this.nowcastHandler) {
        this.socket_io.off("nowcast", this.nowcastHandler);
        this.nowcastHandler = null;
      }
    }
  }

  //    caches.delete("radar-tile-cache");
}
