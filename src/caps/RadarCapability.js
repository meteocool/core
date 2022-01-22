import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Style } from "ol/style";
import snow from "../../public/assets/snow.png";
import { dwdLayer, dwdLayerStatic, setDwdCmap } from "../layers/radar";
import { reportError } from "../lib/Toast";
import {
  capDescription,
  capLastUpdated,
  capTimeIndicator,
  lastFocus,
  latLon,
  live,
  radarColorScheme,
  showForecastPlaybutton,
} from "../stores";
import Capability from "./Capability.ts";
import { tileBaseUrl, v2APIBaseUrl } from "../urls";

function setPattern(style) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const photo = new Image();
  photo.onload = function () {
    canvas.width = photo.width;
    canvas.height = photo.height;
    const pattern = context.createPattern(photo, "repeat");
    style.getFill().setColor(pattern);
  };
  photo.src = snow;
}

export default class RadarCapability extends Capability {
  constructor(map, additionalLayers, options) {
    super(map, "radar", () => {
      capDescription.set("Radar Reflectivity");
      showForecastPlaybutton.set(true);
    }, additionalLayers);

    this.layer = null;
    this.layers = {};
    this.nanobar = options.nanobar;
    this.socket_io = options.socket_io;
    this.latlon = null;
    this.sources = {};
    this.layerFactory = dwdLayerStatic;
    this.serverGrid = null;
    this.clientGrid = null;
    this.trackingMode = "live";
    this.serverTime = 0;
    this.snowOverlay = null;

    const self = this;
    radarColorScheme.subscribe((colorScheme) => {
      setDwdCmap(colorScheme);

      const oldLayer = self.layer;
      if (super.getMap()) {
        super.getMap()
          .removeLayer(oldLayer);
      }
      self.layer = null;
      self.source = null;
      if (colorScheme === "classic" && this.layer !== dwdLayerStatic) {
        if (super.getMap()) {
          super.getMap()
            .getView()
            .setConstrainResolution(false);
        }
        self.layerFactory = dwdLayerStatic;
      } else if (colorScheme !== "classic" && this.layer !== dwdLayer) {
        if (super.getMap()) {
          super.getMap()
            .getView()
            .setConstrainResolution(true);
        }
        self.layerFactory = dwdLayer;
      }
      this.reloadAll();
    });

    latLon.subscribe((latlonUpdate) => {
      if (!latlonUpdate) return true;
      const [lat, lon] = latlonUpdate;
      if (self.latlon) {
        const [oldLat, oldLon] = this.latlon;
        if (Math.abs(oldLat - lat) > 0.001 || Math.abs(oldLon - lon) > 0.001) {
          self.latlon = latlonUpdate;
          this.reloadAll();
        }
      } else {
        self.latlon = latlonUpdate;
        this.reloadAll();
      }
    });

    lastFocus.subscribe(() => {
      if (this.layer) this.reloadAll();
      this.downloadSnowOverlay();
    });

    this.downloadSnowOverlay();

    live.subscribe((value) => {
      if (this.snowOverlay) {
        this.snowOverlay.setVisible(value);
      }
    });

    if (this.socket_io) {
      this.socket_io.on("poke", () => {
        console.log("received websocket poke, refreshing tiles + forecasts");
        this.reloadAll();
      });
      this.socket_io.on("snow", () => {
        console.log("received websocket snow overlay poke, refreshing");
        this.downloadSnowOverlay();
      });
      // this.socket_io.on("progress", (obj) => {
      //   if ("nowcast" in obj) {
      //     processedForecastsCount.set(obj.nowcast);
      //   }
      // });
      this.downloadCurrentRadar();
    }

    this.gridconfig = {};

    // Initialize grid
    this.gridconfig = this.regenerateGridConfig();
    const restartHandler = () => {
      setTimeout(restartHandler, 60000);
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

      if (layerAttributes.source === "observation_wn") {
        const processedDt = new Date(layerAttributes.processed_time * 1000);
        if (processedDt > latestRadar) latestRadar = processedDt;
      }
    });
    this.clientGrid = body;
    this.clientGridConfig = { ...this.gridconfig, grid: body };
    return latestRadar;
  }

  regenerateGridConfig() {
    let gridNow = new Date().getTime() / 1000;
    gridNow -= (gridNow % (60 * 5));
    const start = gridNow - (60 * 120);
    const end = gridNow + (60 * 120);
    const nSteps = ((end - start) / (60 * 5)) + 1;

    const newGridconfig = {
      grid: {},
    };

    [...Array(nSteps)
      .keys()].map((i) => new Date(start + i * (5 * 60)))
      .forEach((step) => {
        newGridconfig.grid[step.getTime()] = {
          dbz: 0,
          url: null,
          tile_id: "",
          source: "",
        };
      });
    newGridconfig.start = start;
    newGridconfig.end = end;
    newGridconfig.now = gridNow;
    newGridconfig.length = nSteps;
    return newGridconfig;
  }

  setUrl(url) {
    this.source.setUrl(url);
  }

  reloadAll() {
    console.log("reloadAll");
    this.downloadCurrentRadar();
  }

  getLocalPostifx() {
    if (this.latlon) {
      return `?lat=${this.latlon[0]}&lon=${this.latlon[1]}`;
    }
    return "";
  }

  downloadCurrentRadar() {
    const URL = `${v2APIBaseUrl}/radar/${this.getLocalPostifx()}`;
    console.log(`Reloading ${URL}`);
    live.set(false);
    this.nanobar.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((obj) => this.processRadar(obj))
      .then(() => this.nanobar.finish(URL))
      .catch((error) => {
        this.nanobar.finish(URL);
        live.set(false);
        reportError(error);
      });
  }

  downloadSnowOverlay() {
    const URL = `${v2APIBaseUrl}/snow/`;
    console.log(`Reloading ${URL}`);
    this.nanobar.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((obj) => this.processSnowOverlay(obj))
      .then(() => this.nanobar.finish(URL))
      .catch((error) => {
        this.nanobar.finish(URL);
        reportError(error);
      });
  }

  processSnowOverlay(obj) {
    const URL = `${tileBaseUrl}/meteoradar/${obj.tile_id}/{z}/{x}/{y}.pbf`;
    if (this.snowOverlay) {
      if (obj.active) {
        console.log("Updating snow overlay URL");
        this.snowOverlay.getSource()
          .setUrl(URL);
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
      });
      this.map.addLayer(this.snowOverlay);
    }
  }

  notifyObservers() {
    this.notify("grid", this.clientGridConfig);
  }

  getMostRecentObservation() {
    let mostRecent = this.serverTime;
    for (const [step, frame] of Object.entries(this.clientGrid)) {
      if (frame) {
        if (frame.source === "") {
          break;
        }
        if (frame.source === "observation_wn" && parseInt(step, 10) > mostRecent) {
          mostRecent = parseInt(step, 10);
        }
      }
    }
    return mostRecent;
  }

  processRadar(obj) {
    if (!obj) return;

    this.serverGrid = obj.frames;
    this.serverTime = obj.server_time;
    this.gridconfig = this.regenerateGridConfig();
    const latestRadar = this.updateClientGridFromServerGrid(this.serverGrid);

    if (!this.layer) {
      const last = this.clientGrid[this.getMostRecentObservation()];
      if (last) {
        [this.layer, this.source] = this.layerFactory(last.tile_id, last.bucket);
        super.getMap().addLayer(this.layer);
      }
    }
    switch (this.trackingMode) {
      case "live":
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
    capLastUpdated.set(latestRadar);
    this.notify("grid", this.clientGridConfig);
  }

  resetToLatest() {
    const mostRecent = this.getMostRecentObservation();
    if (mostRecent in this.clientGrid) {
      if (this.source) this.source.setUrl(this.clientGrid[mostRecent].url);
      capTimeIndicator.set(mostRecent);
      live.set(true);
    }
  }

  setSource(timestep) {
    if (this.trackingMode !== "manual") {
      this.trackingMode = "manual";
      live.set(false);
    }
    if (timestep === this.gridconfig.now) {
      this.trackingMode = "live";
      live.set(true);
    }
    capTimeIndicator.set(timestep);
    if (this.source && timestep in this.clientGrid && this.clientGrid[timestep] && this.clientGrid[timestep].url != null) {
      this.source.setUrl(this.clientGrid[timestep].url);
    }
  }

  //    caches.delete("radar-tile-cache");
}
