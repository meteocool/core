import LayerGroup from "ol/layer/Group";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { bordersAndWays } from "./vector";
import { copernicusAttribution, ororatechAttribution } from "./attributions";

export function sentinel2() {
  return new TileLayer({
    source: new XYZ({
      url: "https://tiles.ororatech.com/worldgrid/s2_msi_worldgrid_tci/{z}/{x}/{-y}.png",
      minZoom: 1,
      maxZoom: 14,
      attributions: [copernicusAttribution, ororatechAttribution],
    }),
    zIndex: 5,
  });
}
export function sentinel3() {
  return new TileLayer({
    source: new XYZ({
      url: "https://tiles.ororatech.com/worldgrid/s3_olci_worldgrid/{z}/{x}/{-y}.png",
      minZoom: 1,
      maxZoom: 8,
      attributions: [copernicusAttribution, ororatechAttribution],
    }),
    zIndex: 5,
  });
}

export function satelliteCombo() {
  return new LayerGroup({
    layers: [
      sentinel2(),
      sentinel3(),
      bordersAndWays(),
    ] });
}
