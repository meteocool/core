import { dwdLayer, dwdLayerStatic, greyOverlay, setDwdCmap } from "../layers/radar";
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
import Capability from "./Capability";
import { tileBaseUrl, v2APIBaseUrl } from "../urls";

export default class RadarCapability extends Capability {
  constructor(options) {
    super((map) => {
      map.addLayer(greyOverlay());
      const additionalLayers = options.additionalLayers || [];
      additionalLayers.forEach((l) => map.addLayer(l));
    }, () => {
      capDescription.set("Radar Reflectivity");
      showForecastPlaybutton.set(true);
    });
    super.setMap(options.map);

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
        if (super.getMap()) super.getMap()
          .getView()
          .setConstrainResolution(false);
        self.layerFactory = dwdLayerStatic;
      } else if (colorScheme !== "classic" && this.layer !== dwdLayer) {
        if (super.getMap()) super.getMap()
          .getView()
          .setConstrainResolution(true);
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
    });

    if (this.socket_io) {
      this.socket_io.on("poke", () => {
        console.log("received websocket poke, refreshing tiles + forecasts");
        this.reloadAll();
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

  updateClientGridFromServerGrid(server, serverTime) {
    let latestRadar = new Date(0);
    const body = { ...this.gridconfig.grid };

    latestRadar = new Date(serverTime * 1000);
    this.serverTime = serverTime;

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
        if (frame.source === "observation" && parseInt(step, 10) > mostRecent) {
          mostRecent = parseInt(step, 10);
        }
      }
    }
    return mostRecent;
  }

  processRadar(obj) {
    if (!obj) return;

    this.serverGrid = obj.frames;
    this.gridconfig = this.regenerateGridConfig();
    const latestRadar = this.updateClientGridFromServerGrid(this.serverGrid, obj.server_time);

    if (!this.layer) {
      const last = this.clientGrid[this.getMostRecentObservation()];
      if (last) {
        [this.layer, this.source] = this.layerFactory(last.tile_id, last.bucket);
        super.addMapCb((map) => {
          map.addLayer(this.layer);
        });
      }
    }
    switch (this.trackingMode) {
      case "live":
        this.resetToLatest();
        break;
      case "manual":
        //if ("server_time" in obj) {
        //  const wantTimestep = this.gridconfig.now + Math.abs(obj.server_time - this.gridconfig.now);
        //  console.log(`wanttimestep=${wantTimestep}`);
        //  if (wantTimestep in this.gridconfig.grid) {
        //    this.setSource(wantTimestep);
        //  }
        //}
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
    if (this.source && timestep in this.clientGrid && this.clientGrid[timestep].url != null) {
      this.source.setUrl(this.clientGrid[timestep].url);
    }
  }

  //    caches.delete("radar-tile-cache");
}
