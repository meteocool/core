import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { DEVICE_PIXEL_RATIO } from 'ol/has';
import OSM from 'ol/source/OSM';
import { maptilerAttribution, osmAttribution } from './attributions';

// eslint-disable-next-line import/prefer-default-export
export const mapTiler = () => new TileLayer({
  source: new XYZ({
    url: 'https://api.maptiler.com/maps/outdoor/{z}/{x}/{y}@2x.png?key=OfAx6294bL9EoRCgzR2o',
    tileSize: 512,
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    attributions: [osmAttribution, maptilerAttribution],
  }),
  base: true,
  zIndex: 1,
});

export const osm = () => new TileLayer({
  source: new OSM({}),
  base: true,
  zIndex: 1,
});
