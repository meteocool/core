import LayerGroup from "ol/layer/Group";
import TileLayer from 'ol/layer/WebGLTile';
import XYZ from "ol/source/XYZ";
import { copernicusAttribution, ororatechAttribution } from "./attributions";

export function sentinel2(cloudy, visible = true) {
  const s2 = new TileLayer({
    source: new XYZ({
      url: `https://tiles.ororatech.com/worldgrid/s2_msi_worldgrid_tci${cloudy ? "" : "_cloud_masked"}/{z}/{x}/{-y}.png`,
      minZoom: 1,
      maxZoom: 13,
      attributions: [copernicusAttribution, ororatechAttribution],
    }),
    zIndex: 6,
  });
  s2.set("cloudy", cloudy);
  s2.setVisible(visible);
  return s2;
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
  const lg = new LayerGroup({
    layers: [
      sentinel3(true),
      sentinel2(false),
    ],
  });
  lg.set("base", true);
  return lg;
}
