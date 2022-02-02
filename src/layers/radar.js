/* eslint-disable no-param-reassign */
import Feature from "ol/Feature";
import Fill from "ol/style/Fill";
import ImageLayer from "ol/layer/Image";
import Style from "ol/style/Style";
import TileLayer from "ol/layer/WebGLTile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { DEVICE_PIXEL_RATIO } from "ol/has";
import { Raster as RasterSource } from "ol/source";
import { transformExtent } from "ol/proj";
import XYZ from "ol/source/XYZ";
import { dwdAttribution } from "./attributions";
import { dwdExtentInv } from "./extents";
import { tileBaseUrl } from "../urls";
import { NOWCAST_OPACITY } from "./ui";
import { cmapDiffFromString, cmapFromString } from '../lib/cmap_utils';
import { RVP6_CLASSIC, RVP6_HOMEYER, RVP6_NWS } from '../colormaps';

let cmap = RVP6_CLASSIC;

export const dwdSource = (tileId, bucket = "meteoradar") => {
  const sourceUrl = `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;
  const reflectivitySource = new XYZ({
    url: sourceUrl,
    attributions: [dwdAttribution],
    crossOrigin: "anonymous",
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    tileSize: 512,
    cacheSize: 999999,
    imageSmoothing: false,
  });
  reflectivitySource.set("tile_id", tileId);
  return reflectivitySource;
};

export const dwdLayerStatic = (tileId, bucket) => {
  const reflectivitySource = dwdSource(tileId, bucket);
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 80,
    opacity: NOWCAST_OPACITY,
  });

  // Disable browser upsampling
  reflectivityLayer.on("prerender", (evt) => {
    evt.context.imageSmoothingEnabled = false;
    evt.context.msImageSmoothingEnabled = false;
  });

  reflectivityLayer.setExtent(
    transformExtent([2.8125, 45, 19.6875, 56.25], "EPSG:4326", "EPSG:3857"),
  );

  reflectivityLayer.set("tile_id", tileId);
  return [reflectivityLayer, reflectivitySource, ""];
};

let lastRasterRadar = null;

export const dwdLayer = (tileId, bucket = "meteoradar") => {
  const sourceUrl = `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;
  const reflectivitySource = new XYZ({
    url: sourceUrl,
    attributions: [dwdAttribution],
    crossOrigin: "anonymous",
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tilePixelRatio: 1,
    tileSize: 512,
    cacheSize: 999999,
    imageSmoothing: false,
  });

  const toColorId = [
    "+",
    ["*", 255 * 256 * 256, ["band", 1]],
    ["+", ["*", 255 * 256, ["band", 2]], ["*", 255, ["band", 3]]],
  ];

  const indexes = RVP6_CLASSIC.map((rgba) => {
    const [r, g, b, _] = rgba;
    return (r * 256 * 256) + (g * 256) + b;
  });

  const cmapAlphaNorm = cmap.map((color) => [color[0], color[1], color[2], color[3] / 255]);
  const matches = indexes.map((element, index) => [element, cmapAlphaNorm[index]]).flat();

  const reflectivityLayer = new TileLayer({
    zIndex: 3,
    opacity: NOWCAST_OPACITY,
    source: reflectivitySource,
    extent: transformExtent([2.8125, 45, 19.6875, 56.25], "EPSG:4326", "EPSG:3857"),
    style: {
      color: [
        "match",
        toColorId,
        ...matches,
        [255, 0, 0, 0],
      ],
    },
  });
  reflectivityLayer.set("tileId", tileId);
  return [reflectivityLayer, reflectivitySource, sourceUrl];
};

export function setDwdCmap(colorMapString) {
  [cmap] = cmapFromString(colorMapString);
  if (lastRasterRadar) {
    lastRasterRadar.changed(); // XXX only works for the last layer
  }
}

export const radolanOverlay = () => new VectorLayer({
  zIndex: 1000,
  renderBuffer: 500,
  source: new VectorSource({
    features: [
      new Feature({
        geometry: dwdExtentInv,
        name: "DarkOverlay",
      }),
    ],
  }),
  style: new Style({
    fill: new Fill({
      color: "rgba(0, 0, 0, 0.1)",
    }),
  }),
});

export const dwdPrecipTypes = (tileId, bucket = "meteoradar") => {
  const sourceUrl = `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;
  const reflectivitySource = new XYZ({
    url: sourceUrl,
    attributions: [dwdAttribution],
    crossOrigin: "anonymous",
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tilePixelRatio: DEVICE_PIXEL_RATIO > 1 ? 2 : 1, // Retina support
    tileSize: 512,
    cacheSize: 999999,
    imageSmoothing: false,
  });
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 3,
    opacity: NOWCAST_OPACITY,
  });
  return reflectivityLayer;
};
