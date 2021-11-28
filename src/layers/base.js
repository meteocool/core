import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { DEVICE_PIXEL_RATIO } from "ol/has";
import OSM from "ol/source/OSM";
import LayerGroup from "ol/layer/Group";
import {
  cartoAttribution,
  osmAttribution,
  cyclosmAttribution,
} from "./attributions";
import { labelsOnly } from "./vector";

const retina = DEVICE_PIXEL_RATIO > 1 ? "@2x" : "";

export const cartoDark = () => new LayerGroup({
  layers: [new TileLayer({
    source: new XYZ({
      url: `https://cartodb-basemaps-{a-c}.global.ssl.fastly.net/rastertiles/dark_nolabels/{z}/{x}/{y}${retina}.png`,
      attributions: [osmAttribution, cartoAttribution],
      maxZoom: 20,
    }),
    base: true,
    preload: Infinity,
    zIndex: 1,
  }), labelsOnly()],
});

export const cartoLight = () => new LayerGroup({
  layers: [new TileLayer({
    source: new XYZ({
      url: `https://cartodb-basemaps-{a-c}.global.ssl.fastly.net/rastertiles/voyager_nolabels/{z}/{x}/{y}${retina}.png`,
      attributions: [osmAttribution, cartoAttribution],
      tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
      maxZoom: 20,
    }),
    base: true,
    preload: Infinity,
    zIndex: 1,
  }), labelsOnly()],
});

export const osm = () => new TileLayer({
  source: new OSM(),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const cyclosm = () => new TileLayer({
  source: new XYZ({
    url: `https://{a-c}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`,
    attributions: [osmAttribution, cyclosmAttribution],
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});

export const bw = () => new TileLayer({
  source: new XYZ({
    url: `https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png `,
    attributions: [osmAttribution, cyclosmAttribution],
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    maxZoom: 20,
  }),
  base: true,
  preload: Infinity,
  zIndex: 1,
});
