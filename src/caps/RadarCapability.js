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

    const self = this;
    radarColorScheme.subscribe((colorScheme) => {
      setDwdCmap(colorScheme);

      const oldLayer = self.layer;
      if (super.getMap()) {
        super.getMap().removeLayer(oldLayer);
      }
      self.layer = null;
      if (colorScheme === "classic") {
        if (super.getMap()) super.getMap().getView().setConstrainResolution(false);
        self.layerFactory = dwdLayerStatic;
      } else {
        if (super.getMap()) super.getMap().getView().setConstrainResolution(true);
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

  updateClientGridFromServerGrid(server) {
    let latestRadar = new Date(0);
    const body = { ...this.gridconfig.grid };
    Object.keys(server).forEach((step) => {
      const layerAttributes = server[step];
      if (!(step in body)) {
        console.log("step not in body");
        return;
      }
      if (!layerAttributes) return;

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
    let mostRecent = 0;
    for (const [step, frame] of Object.entries(this.clientGrid)) {
      if (frame.source === "observation" && step > mostRecent) {
        mostRecent = step;
      }
    }
    return mostRecent;
  }

  processRadar(obj) {
    if (!obj) return;

    this.serverGrid = obj.frames;
    this.gridconfig = this.regenerateGridConfig();
    const latestRadar = this.updateClientGridFromServerGrid(this.serverGrid);

    if (this.layer) {
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
    } else {
      const last = this.clientGrid[this.getMostRecentObservation()];
      [this.layer, this.source] = this.layerFactory(last.tile_id, last.bucket);
      super.addMapCb((map) => {
        map.addLayer(this.layer);
      });
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
  // trackRelativeTimestep(timestamp) {
  //   // track this +(relative forcast amount) into the future
  // }

  // if (!this.nowcast) {
  //   this.notify("nowcast", { sources: null });
  // }

  // this.upstreamTime = obj.radar.upstream_time;
  // this.processedTime = obj.radar.processed_time;

  // capTimeIndicator.set(this.upstreamTime);

  // XXX this should be an .equals() method in the dwd layer namespace
  // if (super.getMap() && this.layer) {
  //   if (this.layer.get("tileId") === obj.tile_id && !this.forceRecreate) {
  //     return;
  //   }
  //   super.getMap().removeLayer(this.layer);
  //   this.forceRecreate = false;
  // }
  // [this.layer, this.source, this.lastSourceUrl] =
  // window.l = this.source;
  // this.layer.setOpacity(NOWCAST_TRANSPARENCY);
  // XXX instead of this, call mapcb (?)
  // super.getMap().addLayer(this.layer);
  // this.downloadNowcast();
  // }

  // downloadHistoricRadar() {
  //  this.nanobar.start("historic_nowcast");
  //  fetch(`${apiBaseUrl}/radar_historic/${this.getLocalPostifx()}`)
  //    .then((response) => response.json())
  //    .then((obj) => this.processHistoricRadar(obj))
  //    .then(() => this.nanobar.finish("historic_nowcast"))
  //    .catch((error) => {
  //      this.nanobar.finish("historic_nowcast");
  //      reportError(error);
  //    });
  // }

  // processHistoricRadar(obj) {
  //   this.historicLayers = obj;
  //   const sources = {};
  //   obj.forEach((interval, index) => {
  //     sources[index * (-5)] = {
  //       url: `${tileBaseUrl}/meteoradar/${interval.tile_id}/{z}/{x}/{-y}.png`,
  //       tile_id: interval.tile_id,
  //     };
  //     if ("reported_intensity" in interval) {
  //       sources[index * (-5)].reported_intensity = interval.reported_intensity;
  //     }
  //   });
  //   this.notify("historic", { sources });
  // }

  // downloadNowcast(cb) {
  //  const response = {
  //    upstreamTime: this.upstreamTime,
  //    processedTime: this.processedTime,
  //    sources: null,
  //  };

  //  console.log(`${this.nowcast.length} nowcast steps available`);
  //  if (this.nowcast.length > 0) {
  //    response.sources = {};
  //    const self = this;
  //    caches.delete("radar-tile-cache");
  //    this.nowcast.forEach((interval) => {
  //      response.sources[interval.prediction_time] = {
  //        url: `${tileBaseUrl}/meteonowcast/${interval.tile_id}/{z}/{x}/{-y}.png`,
  //        tile_id: interval.tile_id,
  //        time: self.upstreamTime + interval.prediction_time * 60,
  //      };
  //      if ("reported_intensity" in interval) {
  //        response.sources[interval.prediction_time].reported_intensity = interval.reported_intensity;
  //      }
  //    });
  //  }
  //  this.notify("nowcast", response);
  //  if (cb) cb(response);
  // }
}
