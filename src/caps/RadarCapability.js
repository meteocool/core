import { dwdLayer, greyOverlay } from "../layers/radar";
import { reportError } from "../lib/Toast";
import { capDescription, capLastUpdated } from "../stores";
import { Capability } from './Capability';
import { apiBaseUrl, tileBaseUrl, websocketBaseUrl } from '../urls';
import { io } from "socket.io-client";

export class RadarCapability extends Capability {
  constructor(options) {
    super((map) => {
      map.addLayer(greyOverlay());
      if (this.layer) {
        map.addLayer(this.layer);
      }
    }, () => capDescription.set("Radar Reflectivity"));

    this.layer = null;
    this.nanobar = options.nanobar;
    this.nowcast = null;
    this.url = options.tileURL;

    super.setMap(options.map);
    this.reloadTilesRadar();

    const socket = io(`${websocketBaseUrl}radar_ws/`);
    socket.on("connect", () => {
      console.log("radar websocket connected!");
    });
    socket.on("poke", () => {
      console.log("received websocket poke, refreshing layers");
      this.reloadTilesRadar();
    });
  }

  reloadTilesRadar() {
    this.nanobar.start(this.url);
    fetch(this.url)
      .then((response) => response.json())
      .then((obj) => {
        if ("radar" in obj) this.processRadar(obj);
        this.nowcast = obj.nowcast;
        console.log(obj);
      })
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }

  getUpstreamTime() {
    return this.upstreamTime;
  }

  processRadar(obj) {
    this.upstreamTime = obj.radar.upstream_time;
    this.processedTime = obj.radar.processed_time;
    capLastUpdated.set(new Date(this.upstreamTime * 1000));

    if (super.getMap() && this.layer) {
      if (this.layer.get("tileId") === obj.tile_id) {
        return;
      }
      super.getMap().removeLayer(this.layer);
    }
    [this.layer, this.source] = dwdLayer(obj.radar.tile_id, { mainLayer: true });
    this.layer.setOpacity(0.85);
    super.getMap().addLayer(this.layer);
  }

  downloadHistoric() {
    this.nanobar.start("historic_nowcast");
    fetch(`${apiBaseUrl}radar_historic/`)
      .then((response) => response.json())
      .then((obj) => {
        this.historicLayers = obj;
        const sources = {};
        obj.forEach((radar, index) => {
          sources[index * (-5)] = {
            url: `${tileBaseUrl}/meteoradar/${radar.tile_id}/{z}/{x}/{-y}.png`,
            tile_id: radar.tile_id,
          };
        });
        this.notify("historic", { sources });
      })
      .then(() => this.nanobar.finish("historic_nowcast"))
      .catch((error) => {
        this.nanobar.finish("historic_nowcast");
        reportError(error);
      });
  }

  downloadNowcast(cb) {
    const response = {
      upstreamTime: this.upstreamTime,
      processedTime: this.processedTime,
      sources: null,
    };

    console.log(`${this.nowcast.length} nowcast steps available`);
    if (this.nowcast.length > 0) {
      response.sources = {};
      const self = this;
      this.nowcast.forEach((interval) => {
        response.sources[interval.prediction_time] = {
          url: `${tileBaseUrl}/meteonowcast/${interval.tile_id}/{z}/{x}/{-y}.png`,
          tile_id: interval.tile_id,
          time: self.upstreamTime + interval.prediction_time * 60,
        };
      });
    }
    this.notify("nowcast", response);
    if (cb) cb(response);
  }
}
