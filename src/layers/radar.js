/* eslint-disable no-param-reassign */
import Feature from "ol/Feature";
import Fill from "ol/style/Fill";
import ImageLayer from "ol/layer/Image";
import Style from "ol/style/Style";
import TileLayer from "ol/layer/Tile";
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
import { cmapDiffFromString } from "../lib/cmap_utils";

let cmap = null;

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
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 1000,
  });

  // Disable browser upsampling
  reflectivityLayer.on("prerender", (evt) => {
    evt.context.imageSmoothingEnabled = false;
    evt.context.msImageSmoothingEnabled = false;
    evt.context.webkitImageSmoothingEnabled = false;
    evt.context.mozImageSmoothingEnabled = false;
  });

  const rasterRadar = new RasterSource({
    imageSmoothing: false,
    minZoom: 4,
    maxZoom: 7,
    sources: [reflectivityLayer],
    // XXX eslint converts the following to a syntax error. good job y'all
    // eslint-disable-next-line object-shorthand
    // eslint-disable-next-line func-names
    operation: function(pixels, data) {
      function d2h(d) {
        return (d).toString(16).padStart(2, "0");
      }

      const key = `${d2h(pixels[0][0])}${d2h(pixels[0][1])}${d2h(pixels[0][2])}`;
      if (!(key in data.cmap)) {
        const avg = (pixels[0][0] + pixels[0][1] + pixels[0][2]) / 3;
        return [avg, avg, avg];
      }
      pixels[0][0] -= data.cmap[key][0];
      pixels[0][1] -= data.cmap[key][1];
      pixels[0][2] -= data.cmap[key][2];
      pixels[0][3] -= data.cmap[key][3];

      return pixels[0];
    },
  });
  lastRasterRadar = rasterRadar;
  rasterRadar.on("beforeoperations", (event) => {
    event.data.cmap = cmap;
  });

  const rasterRadarImageLayer = new ImageLayer({
    zIndex: 3,
    source: rasterRadar,
    renderBuffer: 500,
    title: "Radar Composite",
    opacity: NOWCAST_OPACITY,
    id: tileId,
  });
  rasterRadarImageLayer.setExtent(
    transformExtent([2.8125, 45, 19.6875, 56.25], "EPSG:4326", "EPSG:3857"),
  );

  rasterRadarImageLayer.set("tileId", tileId);
  return [rasterRadarImageLayer, reflectivitySource, sourceUrl];
};

export function setDwdCmap(colorMapString) {
  cmap = cmapDiffFromString(colorMapString);
  if (lastRasterRadar) {
    lastRasterRadar.changed(); // XXX only works for the last layer
  }
}

export const greyOverlay = () => new VectorLayer({
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
  });
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 1000,
    opacity: NOWCAST_OPACITY,
  });

  // Disable browser upsampling
  reflectivityLayer.on("prerender", (evt) => {
    evt.context.imageSmoothingEnabled = false;
    evt.context.msImageSmoothingEnabled = false;
  });
  return reflectivityLayer;
};
