import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { DEVICE_PIXEL_RATIO } from 'ol/has';
import OSM from 'ol/source/OSM';
import {
  cartoAttribution, maptilerAttribution, osmAttribution, imprintAttribution,
} from './attributions';

export const mapTilerOutdoor = () => new TileLayer({
  source: new XYZ({
    url: 'https://api.maptiler.com/maps/outdoor/{z}/{x}/{y}@2x.png?key=OfAx6294bL9EoRCgzR2o',
    tileSize: 512,
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    attributions: [osmAttribution, maptilerAttribution, imprintAttribution],
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const mapTilerSatellite = () => new TileLayer({
  source: new XYZ({
    url: 'https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=zrIk1CJI5tdOGxsTUHo9',
    tileSize: 512,
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    attributions: [maptilerAttribution, imprintAttribution],
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const cartoDark = () => new TileLayer({
  source: new XYZ({
    url: 'https://cartodb-basemaps-{a-c}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
    attributions: [osmAttribution, cartoAttribution, imprintAttribution],
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const cartoLight = () => new TileLayer({
  source: new XYZ({
    url: 'https://cartodb-basemaps-{a-c}.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png',
    attributions: [osmAttribution, cartoAttribution, imprintAttribution],
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const osm = () => new TileLayer({
  source: new OSM(),
  base: true,
  preload: Infinity,
  zIndex: 1,
});
