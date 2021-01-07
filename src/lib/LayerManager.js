import { Map, View } from 'ol';
import { fromLonLat, getTransformFromProjections, get as getProjection } from 'ol/proj';
import Collection from 'ol/Collection';
import { defaults } from 'ol/control';
import Attribution from 'ol/control/Attribution';
import { circular as circularPolygon } from 'ol/geom/Polygon';

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { cartoDark, mapTilerOutdoor, osm } from '../layers/base';
import { reportToast } from './Toast';

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
    this.inhibitDisableTracking = false;
    this.mapBeingMoved = false;

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
    if ((zoom || focus) && !this.mapBeingMoved) {
      view.animate({ center: newCenter, zoom: zoomLevel });
    }
    this.forEachMap((map) => map.render());
    this.inhibitDisableTracking = true;
    reportToast('this.inhibitDisableTracking = true (location update)');
    setTimeout(() => {
      this.inhibitDisableTracking = false;
      reportToast('this.inhibitDisableTracking = false');
    }, 333);
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
    let mapCb = () => {
      this.mapBeingMoved = false;
      reportToast('this.mapBeingMoved=false');
    };
    if (document.currentScript.getAttribute('device') !== 'ios') {
      controls = defaults({ attribution: false }).extend([new Attribution({
        collapsible: false,
      })]);
    } else {
      const self = this;
      mapCb = () => {
        self.mapBeingMoved = false;
        reportToast('this.mapBeingMoved=false');
        if (!self.inhibitDisableTracking) {
          reportToast('!this.inhibitDisableTracking: mapMoveEnd');
          window.webkit.messageHandlers.scriptHandler.postMessage('mapMoveEnd');
        }
      };
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
    if (mapCb) newMap.on('moveend', mapCb);
    newMap.on('movestart', () => {
      this.mapBeingMoved = true;
      reportToast('this.mapBeingMoved=true');
    });
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
}

/* vim: set ts=2 sw=2 expandtab: */
