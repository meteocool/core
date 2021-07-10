import { dwdLayer, dwdLayerStatic, greyOverlay, setDwdCmap } from "../layers/radar";
import { reportError } from "../lib/Toast";
import {
  capDescription,
  latLon, processedForecastsCount,
  radarColorScheme,
  showForecastPlaybutton
} from "../stores";
import Capability from "./Capability";
import { tileBaseUrl, v2APIBaseUrl } from "../urls";

export default class RadarCapability extends Capability {
  constructor(options) {
    super((map) => {
      map.addLayer(greyOverlay());
      const additionalLayers = options.additionalLayers || [];
      additionalLayers.forEach((l) => super.getMap().addLayer(l));
    }, () => {
      capDescription.set("Radar Reflectivity");
      showForecastPlaybutton.set(true);
    });
    super.setMap(options.map);

    this.layer = null;
    this.layers = {};
    this.nanobar = options.nanobar;
    this.socket_io = options.socket_io;
    this.nowcast = null;
    this.lastSourceUrl = "";
    this.latlon = null;
    this.sources = {};
    this.layerFactory = dwdLayerStatic;

    const self = this;
    radarColorScheme.subscribe((colorScheme) => {
      setDwdCmap(colorScheme);
      if (colorScheme === "classic") {
        self.layerFactory = dwdLayerStatic;
      } else {
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

    if (this.socket_io) {
      this.socket_io.on("poke", () => {
        console.log("received websocket poke, refreshing tiles + forecasts");
        this.reloadAll();
      });
      this.socket_io.on("progress", (obj) => {
        if ("nowcast" in obj) {
          processedForecastsCount.set(obj.nowcast);
        }
      });
    }
  }

  setUrl(url) {
    this.source.setUrl(url);
  }

  reloadAll() {
    this.downloadCurrentRadar();
  }

  getLocalPostifx() {
    if (this.latlon) {
      return `?lat=${this.latlon[0]}&lon=${this.latlon[1]}`;
    }
    return "";
  }

  getUpstreamTime() {
    return this.upstreamTime;
  }

  downloadCurrentRadar() {
    const URL = `${v2APIBaseUrl}/radar/${this.getLocalPostifx()}`;
    console.log(`Reloading ${URL}`);
    this.nanobar.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((obj) => this.processRadar(obj))
      .then(() => this.nanobar.finish(URL))
      .catch((error) => {
        this.nanobar.finish(URL);
        reportError(error);
      });
  }

  notifyObservers() {
    this.notify("radar", this.sources);
  }

  getMostRecentObservation() {
    let mostRecent = 0;
    for (const [step, frame] of Object.entries(this.sources)) {
      if (frame.source === "observation" && step < mostRecent) {
        mostRecent = step;
      }
    }
    return mostRecent;
  }

  processRadar(obj) {
    if (!obj) return;

    const body = {};
    Object.keys(obj.frames).forEach((step) => {
      const layerAttributes = obj.frames[step];
      if (!layerAttributes) return;

      const bucket = layerAttributes.source === "observation" ? "meteoradar" : "meteonowcast";
      const sourceUrl = `${tileBaseUrl}/${bucket}/${layerAttributes.tile_id}/{z}/{x}/{-y}.png`;

      this.sources[step] = layerAttributes;
      this.sources[step].url = sourceUrl;
      this.sources[step].bucket = bucket;

      body[step] = this.sources[step];
    });

    const last = this.sources[this.getMostRecentObservation()];
    [this.layer, this.source] = this.layerFactory(last.tile_id, last.bucket);
    super.addMapCb((map) => {
      map.addLayer(this.layer);
    });

    this.notify("radar", body);
  }

    // if (!this.nowcast) {
    //   this.notify("nowcast", { sources: null });
    // }

    // this.upstreamTime = obj.radar.upstream_time;
    // this.processedTime = obj.radar.processed_time;

    // capLastUpdated.set(new Date(this.processedTime * 1000));
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
    //super.getMap().addLayer(this.layer);
    //this.downloadNowcast();
  //}

  //downloadHistoricRadar() {
  //  this.nanobar.start("historic_nowcast");
  //  fetch(`${apiBaseUrl}/radar_historic/${this.getLocalPostifx()}`)
  //    .then((response) => response.json())
  //    .then((obj) => this.processHistoricRadar(obj))
  //    .then(() => this.nanobar.finish("historic_nowcast"))
  //    .catch((error) => {
  //      this.nanobar.finish("historic_nowcast");
  //      reportError(error);
  //    });
  //}

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

  //downloadNowcast(cb) {
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
  //}
}
