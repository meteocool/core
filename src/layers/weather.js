import LayerGroup from "ol/layer/Group";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { centralEuropeExtent } from "./extents";
import { tileBaseUrl } from "./urls";
import { dwdAttribution, imprintAttribution } from "./attributions";

// eslint-disable-next-line import/prefer-default-export
export const weatherLayer = (tileID) => {
  const source =
      new XYZ({
        url: `${tileBaseUrl}/meteomodels/${tileID}/{z}/{x}/{-y}.png`,
        minZoom: 1,
        maxZoom: 14,
        attributions: [dwdAttribution, imprintAttribution],
        transition: 300,
        cacheSize: 99999,
      });
     return [source, new LayerGroup({
    title: tileID,
    layers: [
      new TileLayer({
        source,
        zIndex: 5,
        extent: centralEuropeExtent,
        preload: Infinity,
        opacity: 0.9,
      }),
    ],
  })];
};
