import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Style } from "ol/style";
import snow from "../assets/snow.png";
import { DWDLayerFactoryGL, dwdLayerStatic, setDwdCmap } from "../layers/dwd";
import type { LayerFactory } from "../layers/dwd";
import SwissRadarLayer from "../layers/ch";
import {
  capDescription,
  capLastUpdated,
  lastFocus,
  inspectLatLon,
  latLon,
  live,
  radarCadence,
  radarColorScheme,
  radarStale,
  selectedCell,
  setFrames,
  showForecastPlaybutton, snowLayerVisible, zoomlevel,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type ImageTileSource from "ol/source/ImageTile";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions, RadarSocket } from "./options";
import { reportReplay } from "../lib/Toast";
import Capability from "./Capability";
import { tileBaseUrl } from "../urls";
import { fetchRadarTimeseries, fetchSnowOverlay } from "../api";
import { publishCadence } from "../lib/updateCadence";
import { isOutdated } from "../lib/freshness";
import { NOWCAST_OPACITY } from "../layers/ui";
import { get } from "svelte/store";
//import { MeteoTileCache, mcTileCache } from "../lib/TileCache";

const DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL = 12;

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
  layer: BaseLayer | null;

  /** The tile source behind `layer`; its URL is swapped as playback moves. */
  source: ImageTileSource | null = null;

  layers: Record<string, BaseLayer>;

  sources: Record<string, ImageTileSource>;

  /** Builds a layer for a tile set; swapped when the colormap changes. */
  layerFactory: LayerFactory;

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
   * MeteoSwiss's reflectivity composite -- a second, independent tile layer,
   * not part of the DWD grid/GridStep this class otherwise manages. See
   * `layers/ch.ts` for why the two stay separate.
   */
  private swissRadar: SwissRadarLayer;

  /** Mirror of the radarStale store, so the layer can be dimmed without a get(). */
  stale: boolean;

  /** Whether a cell's popup is open, which is the other reason to dim it. */
  private inspecting = false;

  private nanobar: NanobarWrapper;

  private socket_io?: RadarSocket;

  /** Kept so destroy() can take these back off the socket again. */
  private pokeHandler: (() => void) | null = null;

  private snowHandler: (() => void) | null = null;

  /** The self-rescheduling grid refresh, so destroy() can stop it. */
  private gridRefreshTimeout: number | null = null;

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
    this.sources = {};
    this.layerFactory = dwdLayerStatic;
    this.serverGrid = null;
    this.clientGrid = null;
    this.trackingMode = "live";
    this.serverTime = 0;
    this.snowOverlay = null;
    this.stale = false;
    this.swissRadar = new SwissRadarLayer(map);

    window.radar = this;

    //mcTileCache.setMap(map);
    radarColorScheme.subscribe((colorScheme) => {
      setDwdCmap(colorScheme);

      const oldLayer = this.layer;
      if (oldLayer && super.getMap()) {
        super.getMap().removeLayer(oldLayer);
      }
      this.layer = null;
      this.source = null;
      // These compared this.layer -- a layer -- against a layer *factory*, so
      // both tests were vacuously true.
      if (colorScheme === "classic" && this.layerFactory !== dwdLayerStatic) {
        this.layerFactory = dwdLayerStatic;
      } else if (colorScheme !== "classic" && this.layerFactory !== DWDLayerFactoryGL) {
        this.layerFactory = DWDLayerFactoryGL;
      }
      this.reloadAll();
    });

    latLon.subscribe((latlonUpdate) => {
      if (!latlonUpdate) return true;
      const [lat, lon] = latlonUpdate;
      if (this.latlon) {
        const [oldLat, oldLon] = this.latlon;
        if (Math.abs(oldLat - lat) > 0.001 || Math.abs(oldLon - lon) > 0.001) {
          this.latlon = latlonUpdate;
          this.reloadAll();
        }
      } else {
        this.latlon = latlonUpdate;
        this.reloadAll();
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
      this.reloadAll();
    });

    /* Order matters: the verdict is published before the refetch goes out, so
       the map says it is out of date for the round trip rather than after it. */
    lastFocus.subscribe(() => {
      this.refreshStaleness();
      if (this.layer) this.reloadAll();
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
        this.downloadSnowOverlay();
      } else {
        this.processSnowOverlay({ active: false });
      }
    });

    zoomlevel.subscribe((z) => {
      if (this.snowOverlay) {
        this.snowOverlay.setOpacity(z > DECREASE_SNOW_TRANSPARENCY_ZOOMLEVEL ? 0.5 : 1);
      }
    });

    if (this.socket_io) {
      this.pokeHandler = () => {
        console.log("received websocket poke, refreshing tiles + forecasts");
        this.reloadAll();
      };
      this.snowHandler = () => {
        console.log("received websocket snow overlay poke, refreshing");
        this.downloadSnowOverlay();
      };
      this.socket_io.on("poke", this.pokeHandler);
      this.socket_io.on("snow", this.snowHandler);
      this.downloadCurrentRadar();
      this.swissRadar.refresh(this.nanobar);
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
    restartHandler();
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
      const sourceUrl = `${tileBaseUrl}/${bucket}/${layerAttributes.tile_id}/{z}/{x}/{-y}.png`;

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

  tilesetToURL(tileset) {
    return `${tileBaseUrl}/${tileset.bucket}/${tileset.tile_id}/`;
  }

  precacheAllForecasts() {
    // Object.values(this.clientGridConfig.grid)
    //   .filter((e) => e.source === "nowcast_phys")
    //   .map((e) => ({ tile_id: e.tile_id, bucket: e.bucket }))
    //   .map((tileset) => this.tilesetToURL(tileset))
    //   .forEach((tileset) => {
    //     mcTileCache.cacheTileset(tileset);
    //     mcTileCache.trackTileset(tileset, 5);
    //   });
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

  reloadAll() {
    console.log("reloadAll");
    this.downloadCurrentRadar();
    this.swissRadar.refresh(this.nanobar);
  }

  /** Where the forecast is sampled: a tapped point, else the client's own. */
  getPosition() {
    const at = this.inspectLatlon ?? this.latlon;
    return at ? { lat: at[0], lon: at[1] } : undefined;
  }

  async downloadCurrentRadar() {
    live.set(false);
    const data = await fetchRadarTimeseries(this.nanobar, this.getPosition()).catch(() => null);
    if (!data) {
      live.set(false);
      return;
    }
    this.processRadar(data);
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
    this.serverTime = obj.server_time;
    // The backend is the only thing that knows: a replay is built to be
    // indistinguishable from here, so there is nothing in the frames to infer
    // it from.
    if (obj.replay) reportReplay();
    this.gridconfig = this.regenerateGridConfig();
    const latestRadar = this.updateClientGridFromServerGrid(this.serverGrid);

    if (!this.layer) {
      const last = this.clientGrid?.[this.getMostRecentObservation()];
      if (last) {
        [this.layer, this.source] = this.layerFactory(last.tile_id, last.bucket);
        // mcTileCache.setSource(this.source);
        super.getMap().addLayer(this.layer);
      }
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
    if (this.clientGrid && mostRecent in this.clientGrid) {
      const url = this.clientGrid[mostRecent].url;
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
    const step = this.clientGrid?.[timestep];
    if (this.source && step && step.url != null) {
      this.source.setUrl(step.url);
    }
  }

  destroy() {
    this.swissRadar.destroy();
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
    }
  }

  //    caches.delete("radar-tile-cache");
}
