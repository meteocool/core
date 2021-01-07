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

    Object.keys(this.capabilities).forEach((capability) => {
      const newMap = this.makeMap(capability);
      this.capabilities[capability].setMap(newMap);
      this.maps.push(newMap);
    });
  }

  updateLocation(lat, lon, accuracy, zoom = false, focus = true) {
    let accuracyPoly = null;
    if (accuracy >= 0) {
      accuracyPoly = circularPolygon([lon, lat], accuracy, 64);
      accuracyPoly.applyTransform(getTransformFromProjections(getProjection('EPSG:4326'), getProjection('EPSG:3857')));
    }
    this.accuracyFeatures.forEach((feature) => feature.setGeometry(accuracyPoly));
    let centerPoint;
    const center = fromLonLat([lon, lat]);
    if (lat === -1 && lon === -1 && accuracy === -1) {
      centerPoint = null;
    } else {
      centerPoint = center ? new Point(center) : null;
    }
    this.positionFeatures.forEach((feature) => feature.setGeometry(centerPoint));

    if (centerPoint === null) return;

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
      view.animate({ center: newCenter, zoom: zoomLevel, duration: 500 });
    }
    this.forEachMap((map) => map.render());
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
    const mapCb = () => {
      this.mapBeingMoved = false;
      reportToast('this.mapBeingMoved=false');
    };
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
}

/* vim: set ts=2 sw=2 expandtab: */
