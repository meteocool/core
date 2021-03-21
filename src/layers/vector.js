import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import { Stroke, Style, Fill, Text } from "ol/style";
import MVT from "ol/format/MVT";
import {
  imprintAttribution,
  osmAttribution,
  wofAttribution,
} from "./attributions";

const boundaryStyle = new Style({
  stroke: new Stroke({
    color: "#454542",
    width: 2,
  }),
  zIndex: 1,
});

const getBoundaryStyle = (feature) => {
  const kind = feature.get("kind");
  if (kind !== "country") {
    return null;
  }
  return boundaryStyle;
};

const countryStyle = new Style({
  text: new Text({
    font: "18px Calibri,sans-serif",
    fill: new Fill({
      color: "#000",
    }),
    overflow: true,
    stroke: new Stroke({
      color: "#fff",
      width: 4,
    }),
    zIndex: 100,
  }),
});

const regionStyle = new Style({
  text: new Text({
    font: "16px Calibri,sans-serif",
    fill: new Fill({
      color: "#000",
    }),
    overflow: true,
    stroke: new Stroke({
      color: "#fff",
      width: 3,
    }),
    zIndex: 90,
  }),
});

const localityStyle = new Style({
  text: new Text({
    font: "12px Calibri,sans-serif",
    fill: new Fill({
      color: "#000",
    }),
    overflow: true,
    padding: [5, 5, 5, 5],
    stroke: new Stroke({
      color: "#fff",
      width: 2,
    }),
    zIndex: 90,
  }),
});

const microLabelStyle = new Style({
  text: new Text({
    font: "11px Calibri,sans-serif",
    fill: new Fill({
      color: "#000",
    }),
    overflow: true,
    stroke: new Stroke({
      color: "#fff",
      width: 1.5,
    }),
    zIndex: 90,
  }),
});

export const bordersAndWays = () => new VectorTileLayer({
  zIndex: 99,
  declutter: true,
  source: new VectorTileSource({
    attributions: [wofAttribution, osmAttribution, imprintAttribution],
    format: new MVT({
      layers: ["boundaries", "places"],
    }),
    url: `https://tile.nextzen.org/tilezen/vector/v1/all/{z}/{x}/{y}.mvt?api_key=qW-EcxRGQcanc6upJoSHSA`,
    maxZoom: 17,
  }),
  style(feature) {
    let style;
    switch (feature.get("layer")) {
      case "places":
        switch (feature.get("kind")) {
          case "country":
            style = countryStyle;
            break;
          case "region":
            style = regionStyle;
            break;
          case "locality":
            style = localityStyle;
            break;
          default:
            break;
        }
        style.getText().setText(feature.get("name"));
        return style;
      case "boundaries":
        return getBoundaryStyle(feature);
      default:
        return null;
    }
  },
});

export const labelsOnly = () => new VectorTileLayer({
  zIndex: 99,
  declutter: true,
  source: new VectorTileSource({
    attributions: [wofAttribution, osmAttribution, imprintAttribution],
    format: new MVT({
      layers: ["places"],
    }),
    url: `https://tile.nextzen.org/tilezen/vector/v1/all/{z}/{x}/{y}.mvt?api_key=qW-EcxRGQcanc6upJoSHSA`,
    maxZoom: 17,
  }),
  style(feature, res) {
    let style;
    // console.log(`${feature.get("name")}:  ${feature.get("kind")}/${feature.get("kind_detail")} @ ${res} / ${feature.get("population")}`);
    switch (feature.get("layer")) {
      case "places":
        switch (feature.get("kind")) {
          case "region":
            style = regionStyle;
            break;
          case "locality":
            if (feature.get("kind_detail") === "town") {
              if (res < 100) {
                style = microLabelStyle;
              }
              if (feature.get("population") > 20000) {
                style = localityStyle;
              }
            } else {
              style = localityStyle;
            }
            break;
          default:
            if (res > 80) {
              return null;
            }
            switch (feature.get("kind_detail")) {
              case "village":
                style = microLabelStyle;
                break;
              default:
                style = microLabelStyle;
                break;
            }
            break;
        }
        if (!style) return null;
        style.getText().setText(feature.get("name"));
        return style;
      default:
        return null;
    }
  },
});
