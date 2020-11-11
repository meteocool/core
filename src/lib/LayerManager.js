import { Map, View } from 'ol';
import { fromLonLat, getTransformFromProjections, get as getProjection } from 'ol/proj';
import Collection from 'ol/Collection';
import { defaults } from 'ol/control';
import Attribution from 'ol/control/Attribution';
import { circular as circularPolygon } from 'ol/geom/Polygon.js';

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { viridis, meteocoolClassic } from '../colormaps.js';
import { cartoDark, mapTilerOutdoor, osm } from '../layers/base';

// var whenMapIsReady = (map, callback) => {
//  if (map.get('ready')) {
//    callback();
//  } else {
//    map.once('change:ready', whenMapIsReady.bind(null, map, callback));
//  }
// };

/**
 * Manages the reflectivity + forecast layers shown on the map.
 */
// eslint-disable-next-line import/prefer-default-export
export class LayerManager {
  constructor(options) {
    this.options = options; // XXX defaults?
    this.settings = options.settings;
    this.capabilities = options.capabilities;
    this.maps = [];
    this.accuracyFeatures = [];
    this.positionFeatures = [];

    Object.keys(this.capabilities).forEach((capability) => {
      const newMap = this.makeMap(capability);
      this.capabilities[capability].setMap(newMap);
      this.maps.push(newMap);
    });
  }

  updateLocation(lat, lon, accuracy, zoom = false, focus = true) {
    let accuracyPoly = null;
    if (accuracy > 0) {
      accuracyPoly = circularPolygon([lon, lat], accuracy, 64);
      accuracyPoly.applyTransform(getTransformFromProjections(getProjection('EPSG:4326'), getProjection('EPSG:3857')));
    }
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(accuracyPoly));
    const center = fromLonLat([lon, lat]);
    const centerPoint = center ? new Point(center) : null;
    this.positionFeatures.forEach((feature) => feature.setGeometry(centerPoint));

    const view = this.maps[0].getView();
    let zoomLevel = view.getZoom();
    const oldCenter = view.getCenter();
    if (zoom) {
      if (accuracy < 200) {
        zoomLevel = 14;
      } else if (accuracy < 400) {
        zoomLevel = 13;
      } else if (accuracy < 800) {
        zoomLevel = 12;
      } else if (accuracy < 2000) {
        zoomLevel = 11;
      } else if (accuracy < 4000) {
        zoomLevel = 10;
      } else {
        zoomLevel = 9;
      }
    }
    let newCenter;
    if (focus) {
      newCenter = center;
    } else {
      newCenter = oldCenter;
    }
    if (zoom || focus) {
      view.animate({ center: newCenter, zoom: zoomLevel });
    }
    this.forEachMap((map) => map.updateSize());
  }

  resetLocation() {
    this.positionFeatures.forEach((feature) => feature.setGeometry(null));
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(null));
  }

  setTarget(cap, target) {
    this.capabilities[cap].setTarget(target);
  }

  setDefaultTarget(target) {
    console.log(`Starting with default cap ${this.settings.get('capability')}`);
    this.setTarget(this.settings.get('capability'), target);
  }

  makeMap(capability) {
    let controls = new Collection();
    if (document.currentScript.getAttribute('device') !== 'ios') {
      controls = defaults({ attribution: false }).extend([new Attribution({
        collapsible: false,
      })]);
    }

    const accuracyFeature = new Feature();
    this.accuracyFeatures.push(accuracyFeature);
    const positionFeature = new Feature();
    this.positionFeatures.push(positionFeature);
    const geolocationPositionLayer = new VectorLayer({
      source: new VectorSource({
        features: [positionFeature],
        kind: 'geolocationPositionLayer',
      }),
      style: new Style({
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({
            color: '#048EF9',
          }),
          stroke: new Stroke({
            color: '#fff',
            width: 3.5,
          }),
        }),
      }),
      zIndex: 99999,
    });
    const geolocationAccuracyLayer = new VectorLayer({
      source: new VectorSource({
        features: [accuracyFeature],
        kind: 'geolocationPositionLayer',
      }),
      zIndex: 99999,
    });

    const newMap = new Map({
      layers: [this.baseLayerFactory(this.settings.get('mapBaseLayer')), geolocationAccuracyLayer, geolocationPositionLayer],
      view: this.maps.length > 0 ? this.maps[0].getView() : new View({
        constrainResolution: true,
        zoom: 7,
        center: fromLonLat([11, 49]),
        enableRotation: this.settings.get('mapRotation'),
      }),
      capability,
      controls,
    });
    newMap.set('capability', capability);
    return newMap;
  }

  baseLayerFactory(layer) {
    switch (layer) {
      case 'osm':
        return osm();
      case 'dark':
        return cartoDark();
      case 'topographic':
      default:
        return mapTilerOutdoor();
    }
  }

  switchBaseLayer(newBaseLayer) {
    this.forEachMap((map) => {
      map.getLayers().getArray().filter((layer) => layer.get('base') === true).forEach((layer) => map.removeLayer(layer));
      map.addLayer(this.baseLayerFactory(newBaseLayer));
    });
  }

  forEachMap(cb) {
    this.maps.forEach((map) => cb(map));
  }

  // hook (handler, action) {
  //  // console.log("emitting event " + action + " to handler: " + handler);
  //  this.appHandlers.forEach((h) => {
  //    h(handler, action);
  //  });
  // }

  // playInProgress () {
  //  return this.currentForecastNo !== -1 && !this.playPaused;
  // }

  // getInFlightTiles () {
  //  return this.numInFlightTiles;
  // }

  // smartDownloadAndPlay () {
  //  if (this.playInProgress()) {
  //    clearTimeout(this.activeForecastTimeout);
  //    document.getElementById("nowcastIcon").src = "./player-play.png";
  //    document.getElementById("nowcastIcon").style.display = "";
  //    this.playPaused = true;
  //    return;
  //  }

  //  if (!this.forecastDownloaded) {
  //    document.getElementById("nowcastIcon").style.display = "none";
  //    document.getElementById("nowcastLoading").style.display = "";
  //    this.downloadForecast(() => {
  //      document.getElementById("nowcastLoading").style.display = "none";
  //      document.getElementById("nowcastIcon").style.display = "";
  //      document.getElementById("nowcastIcon").src = "./player-pause.png";
  //      this.playForecast();
  //    });
  //  } else {
  //    document.getElementById("nowcastIcon").style.display = "";
  //    document.getElementById("nowcastIcon").src = "./player-pause.png";
  //    this.playForecast();
  //  }
  // }

  // switchMainLayer (newLayer) {
  //  // invalidate old forecast
  //  if (this.playInProgress()) {
  //    this.removeForecast();
  //  }
  //  this.stopPlay();
  //  // reset internal forecast state
  //  this.invalidateLayers();

  //  // first add & fetch the new layer, then remove the old one to avoid
  //  // having no layer at all at some point.
  //  this.map.addLayer(newLayer);
  //  this.map.removeLayer(this.mainLayer);
  //  this.mainLayer = newLayer;
  // }

  /// / invalidate (i.e. throw away) downloaded forecast stuff AND reset map to a
  /// / defined state.
  // invalidateLayers () {
  //  this.forecastDownloaded = false;
  //  //this.forecastLayers.forEach((layer) => {
  //  //  if (layer) {
  //  //    this.map.removeLayer(layer["layer"]);
  //  //    layer = false;
  //  //  }
  //  //});
  //  this.hook("scriptHandler", "forecastInvalid");
  // }

  // setForecastLayer (num) {
  //  //if (num === this.currentForecastNo) { return 1; }
  //  //if (!this.forecastDownloaded) { return 2; }
  //  //if (this.playInProgress()) { return 3; }
  //  ////if (num > this.numForecastLayers - 1) { return 4; }

  //  //this.playPaused = true;

  //  //if (num === -1) {
  //  //  this.map.addLayer(this.mainLayer);
  //  //} else {
  //  //  this.map.addLayer(this.forecastLayers[num]["layer"]);
  //  //}

  //  //if (this.currentForecastNo === -1) {
  //  //  this.map.removeLayer(this.mainLayer);
  //  //} else {
  //  //  this.map.removeLayer(this.forecastLayers[this.currentForecastNo]["layer"]);
  //  //}

  //  //this.currentForecastNo = num;
  //  //return true;
  // }

  /// / bring map back to a defined state, without touching the forecast stuff
  // clear () {
  //  this.map.getLayers().forEach((layer) => {
  //    this.map.removeLayer(layer);
  //  });
  // }

  // stopPlay () {
  //  this.currentForecastNo = -1;
  //  this.playPaused = false;
  //  let elem = document.getElementById("nowcastIcon");
  //  if (elem) {
  //    elem.src = "./player-play.png";
  //    elem.style.display = "";
  //    $("#forecastTimeWrapper").css("display", "none");
  //    this.hook("scriptHandler", "playFinished");
  //  }
  // }

  // playForecast (e) {
  //  if (!this.forecastDownloaded) {
  //    console.log("not all forecasts downloaded yet");
  //    return;
  //  }
  //  this.playPaused = false;

  //  if (this.currentForecastNo === this.forecastLayers.length - 1) {
  //    // we're past the last downloaded layer, so end the play
  //    this.map.addLayer(this.mainLayer);
  //    this.map.removeLayer(this.forecastLayers[this.currentForecastNo]["layer"]);
  //    this.stopPlay();
  //    $("#forecastTimeWrapper").css("display", "none");
  //    return;
  //  }

  //  if (this.currentForecastNo < 0) {
  //    // play not yet in progress, remove main layer
  //    this.map.removeLayer(this.mainLayer);
  //    this.hook("scriptHandler", "playStarted");
  //    if (!this.enableIOSHooks) {
  //      $("#forecastTimeWrapper").css("display", "block");
  //    }
  //  } else {
  //    // remove previous layer
  //    this.map.removeLayer(this.forecastLayers[this.currentForecastNo]["layer"]);
  //  }
  //  this.currentForecastNo++;
  //  this.map.addLayer(this.forecastLayers[this.currentForecastNo]["layer"]);

  //  if (this.currentForecastNo >= 0) {
  //    let layerTime = (parseInt(this.forecastLayers[this.currentForecastNo]["version"]) + (this.currentForecastNo + 1) * 5 * 60) * 1000;
  //    let dt = new Date(layerTime);
  //    let dtStr = ("0" + dt.getHours()).slice(-2) + ":" + ("0" + dt.getMinutes()).slice(-2);
  //    $(".forecastTimeInner").html(dtStr);
  //    this.hook("layerTimeHandler", layerTime);
  //  }
  //  this.activeForecastTimeout = window.setTimeout(() => { this.playForecast(); }, 600);
  // }

  // removeForecast () {
  //  if (this.currentForecastNo >= 0) {
  //    this.map.removeLayer(this.forecastLayers[this.currentForecastNo]["layer"]);
  //  }
  //  this.hook("scriptHandler", "playFinished");
  //  this.currentForecastNo = -1;
  // }

  // forecastReady(readyness) {
  //  if (readyness) {
  //    document.getElementById("nowcastLoading").style.display = "none";
  //    document.getElementById("nowcastIcon").style.display = "";
  //    document.getElementById("nowcastIcon").src = "./player-play.png";
  //  } else {
  //    document.getElementById("nowcastLoading").style.display = "";
  //    document.getElementById("nowcastIcon").style.display = "none";
  //  }
  // }

  // processTiles(data) {
  //  // We assume that there is always a reflectivity layer
  //  let newLayer = new TileLayer({
  //    source: new XYZ({
  //      url: this.baseURL + "/" + data["reflectivity"]["tileID"] + "/{z}/{x}/{-y}.png",
  //      maxZoom: 9,
  //      minZoom: 6
  //    }),
  //    opacity: this.opacity
  //  });
  //  newLayer.on("prerender", (evt) => {
  //    // Disable browser up-sampling for satellite maps
  //    evt.context.imageSmoothingEnabled = false;
  //    evt.context.msImageSmoothingEnabled = false;
  //  });
  //  this.switchMainLayer(newLayer);
  //  this.forecastReady(data["forecast"] == true);
  //  this.forecasts = data["forecast"];
  //  //this.hook("timeHandler", data.version.toString());
  // }

  // downloadMainTiles (cb) {
  //  $.getJSON({
  //    dataType: "json",
  //    url: this.mainTileUrl,
  //    success: (data) => {
  //      this.processTiles(data);
  //      if (cb) {
  //        cb(data);
  //      }
  //    }
  //  });
  // }
}

/* vim: set ts=2 sw=2 expandtab: */
