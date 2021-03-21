import LayerGroup from "ol/layer/Group";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { bordersAndWays } from "./vector";
import { centralEuropeExtent } from "./extents";
import { copernicusAttribution } from "./attributions";

export function sentinel2() {
  return new LayerGroup({
    title: "Sentinel-2 (19m/5 days)",
    layers: [
      new TileLayer({
        source: new XYZ({
          url: "https://ot-tiles.s3.eu-central-1.amazonaws.com/s2_msi_worldgrid/{z}/{x}/{-y}.png",
          minZoom: 1,
          maxZoom: 14,
          attributions: [copernicusAttribution],
        }),
        zIndex: 5,
        extent: centralEuropeExtent,
        preload: Infinity,
      }),
      bordersAndWays(),
    ],
  });
}
export function sentinel3() {
  return new LayerGroup({
    title: "Sentinel-3 (300m/0.5 days)",
    layers: [
      new TileLayer({
        source: new XYZ({
          url: "https://ot-tiles.s3.eu-central-1.amazonaws.com/s3_olci_worldgrid/{z}/{x}/{-y}.png",
          minZoom: 1,
          maxZoom: 9,
          attributions: [copernicusAttribution],
        }),
        zIndex: 5,
        preload: Infinity,
      }),
      bordersAndWays(),
    ],
  });
}
