import { dwdLayer, greyOverlay } from "../layers/radar";
import { reportError } from "../lib/Toast";
import { capDescription, capLastUpdated, latLon } from "../stores";
import Capability from "./Capability";
import { apiBaseUrl, tileBaseUrl } from "../urls";
import { NOWCAST_TRANSPARENCY } from "../layers/ui";

export default class RadarCapability extends Capability {
  constructor(options) {
    super((map) => {
      map.addLayer(greyOverlay());
      const additionalLayers = options.additionalLayers || [];
      additionalLayers.forEach((l) => super.getMap().addLayer(l));
    }, () => capDescription.set("Radar Reflectivity"));
    super.setMap(options.map);

    this.layer = null;
    this.nanobar = options.nanobar;
    this.socket_io = options.socket_io;
    this.nowcast = null;
    this.lastSourceUrl = "";
    this.latlon = null;

    const self = this;
    latLon.subscribe((latlonUpdate) => {
      self.latlon = latlonUpdate;
      this.reloadAll();
    });

    if (this.socket_io) {
      this.socket_io.on("poke", () => {
        console.log("received websocket poke, refreshing tiles + forecasts");
        this.reloadAll();
      });
    }
  }

  reloadAll() {
    this.downloadCurrentRadar();
    this.downloadHistoricRadar();
  }

  getLocalPostifx() {
    if (this.latlon) {
      return `${this.latlon[0]}/${this.latlon[1]}/`;
    }
    return "";
  }

  getUpstreamTime() {
    return this.upstreamTime;
  }

  downloadCurrentRadar() {
    // XXX needs more checks to conditionally reload the main layer to save traffic

    const URL = `${apiBaseUrl}/radar/${this.getLocalPostifx()}`;
    this.nanobar.start(URL);
    fetch(URL)
      .then((response) => response.json())
      .then((obj) => this.processCurrentRadar(obj))
      .then(() => this.nanobar.finish(URL))
      .catch((error) => {
        this.nanobar.finish(URL);
        reportError(error);
      });
  }

  processCurrentRadar(obj) {
    this.nowcast = obj.nowcast;
    if (!("radar" in obj)) return;
    this.upstreamTime = obj.radar.upstream_time;
    this.processedTime = obj.radar.processed_time;
    capLastUpdated.set(new Date(this.upstreamTime * 1000));

    // XXX this should be an .equals() method in the dwd layer namespace
    if (super.getMap() && this.layer) {
      if (this.layer.get("tileId") === obj.tile_id) {
        return;
      }
      super.getMap().removeLayer(this.layer);
    }
    [this.layer, this.source, this.lastSourceUrl] = dwdLayer(obj.radar.tile_id, { mainLayer: true });
    this.layer.setOpacity(NOWCAST_TRANSPARENCY);
    // XXX instead of this, call mapcb (?)
    super.getMap().addLayer(this.layer);
    this.downloadNowcast();
  }

  downloadHistoricRadar() {
    this.nanobar.start("historic_nowcast");
    fetch(`${apiBaseUrl}/radar_historic/${this.getLocalPostifx()}`)
      .then((response) => response.json())
      .then((obj) => this.processHistoricRadar(obj))
      .then(() => this.nanobar.finish("historic_nowcast"))
      .catch((error) => {
        this.nanobar.finish("historic_nowcast");
        reportError(error);
      });
  }

  processHistoricRadar(obj) {
    this.historicLayers = obj;
    const sources = {};
    obj.forEach((interval, index) => {
      sources[index * (-5)] = {
        url: `${tileBaseUrl}/meteoradar/${interval.tile_id}/{z}/{x}/{-y}.png`,
        tile_id: interval.tile_id,
      };
      if ("reported_intensity" in interval) {
        sources[index * (-5)].reported_intensity = interval.reported_intensity;
      }
    });
    this.notify("historic", { sources });
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
        if ("reported_intensity" in interval) {
          response.sources[interval.prediction_time].reported_intensity = interval.reported_intensity;
        }
      });
    }
    this.notify("nowcast", response);
    if (cb) cb(response);
  }
}
