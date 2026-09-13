import LayerGroup from "ol/layer/Group";
import TileLayer from "ol/layer/WebGLTile";
import ImageTileSource from "ol/source/ImageTile";
import { centralEuropeExtent } from "./extents";
import { tileBaseUrl } from "../urls";
import { trackTileLoads } from "../lib/tileStatus";
import { dwdAttribution, imprintAttribution } from "./attributions";

export const weatherLayer = (tileID) => {
  const source = trackTileLoads(new ImageTileSource({
    url: `${tileBaseUrl}/meteomodels/${tileID}/{z}/{x}/{-y}.png`,
    minZoom: 1,
    maxZoom: 14,
    attributions: [dwdAttribution, imprintAttribution],
    transition: 300,
  }));
  const group = new LayerGroup({
    layers: [
      new TileLayer({
        source,
        zIndex: 5,
        extent: centralEuropeExtent,
        preload: Infinity,
        opacity: 0.9,
        cacheSize: 256,
      }),
    ],
  });
  // `title` is not a LayerGroup option; OpenLayers would drop it silently.
  group.set("title", tileID);
  return [source, group];
};
