import TileLayer from "ol/layer/WebGLTile";
import XYZ from "ol/source/XYZ";
import { DEVICE_PIXEL_RATIO } from "ol/has";
import OSM from "ol/source/OSM";
import {
  cartoAttribution,
  osmAttribution,
  cyclosmAttribution,
} from "./attributions";

const retina = DEVICE_PIXEL_RATIO > 1 ? "@2x" : "";

export const cartoDark = () => new TileLayer({
  source: new XYZ({
    urls: [`https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/dark_nolabels/{z}/{x}/{y}${retina}.png`,
      `https://cartodb-basemaps-c.global.ssl.fastly.net/rastertiles/dark_nolabels/{z}/{x}/{y}${retina}.png`],
    crossOrigin: null,
    attributions: [osmAttribution, cartoAttribution],
    maxZoom: 20,
  }),
  base: true,
  zIndex: 1,
});

export const cartoLight = () => new TileLayer({
  source: new XYZ({
    urls: [`https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager_nolabels/{z}/{x}/{y}${retina}.png`,
      `https://cartodb-basemaps-c.global.ssl.fastly.net/rastertiles/voyager_nolabels/{z}/{x}/{y}${retina}.png`],
    crossOrigin: null,
    attributions: [osmAttribution, cartoAttribution],
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    maxZoom: 20,
  }),
  base: true,
  zIndex: 1,
});

export const osm = () => new TileLayer({
  source: new OSM(),
  base: true,
  zIndex: 1,
});

export const cyclosm = () => new TileLayer({
  source: new XYZ({
    url: `https://{a-c}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`,
    crossOrigin: null,
    attributions: [osmAttribution, cyclosmAttribution],
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    maxZoom: 20,
  }),
  base: true,
  zIndex: 1,
});

export function supportsVectorLabels(layer) {
  switch (layer) {
    case "light":
    case "dark":
    case "satellite":
      return true;
    default:
      return false;
  }
}
