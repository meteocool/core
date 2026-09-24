import TileLayer from "ol/layer/Tile";
import { TileWMS } from "ol/source";
import { noaaAttribution } from "./attributions";

export const noaaBREF = () => new TileLayer({
  source: new TileWMS({
    url: "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?version=1.3.0",
    params: { LAYERS: "conus_bref_qcd", TILED: true, SRS: "EPSG:3857" },
    projection: "EPSG:3857",
    attributions: [noaaAttribution],
  }),
  zIndex: 80,
  opacity: 0.8,
});
