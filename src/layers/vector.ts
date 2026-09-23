import VectorTileLayer from "ol/layer/VectorTile";
import { Stroke, Style, Fill, Text } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import { getLocaleFromNavigator } from "svelte-i18n";
import { placeNameForLocale } from "./placeName";
import {
  imprintAttribution,
  osmAttribution,
  protomapsAttribution,
} from "./attributions";
import { mapBaseLayer } from "../stores";
import { supportsVectorLabels } from "./base";
import { belowMinZoom, protomapsSource, zoomFromResolution } from "./protomaps";

/**
 * The label and border overlays, drawn *above* the weather so place names stay
 * readable through radar reflectivity.
 *
 * These used to come from Nextzen, which now answers every tile request with
 * "An API key is required" and no longer issues keys -- so both overlays had
 * gone blank. They read meteocool's own Protomaps tiles instead, the same
 * tileset the basemaps come from.
 */

const overlayAttributions = [osmAttribution, protomapsAttribution, imprintAttribution];
const placeName = placeNameForLocale(getLocaleFromNavigator());

/** Labels are decluttered against each other, so one Text style per tier is enough. */
function labelStyle(font: string, haloWidth: number, zIndex: number) {
  return new Style({
    text: new Text({
      font,
      fill: new Fill({ color: "#000" }),
      overflow: true,
      stroke: new Stroke({ color: "#fff", width: haloWidth }),
    }),
    zIndex,
  });
}

const countryStyle = labelStyle("bold 18px Calibri,sans-serif", 4, 100);
const regionStyle = labelStyle("16px Calibri,sans-serif", 3, 90);
const cityStyle = labelStyle("bold 13px Calibri,sans-serif", 3, 92);
const localityStyle = labelStyle("12px Calibri,sans-serif", 2, 90);
const microLabelStyle = labelStyle("11px Calibri,sans-serif", 1.5, 88);

const boundaryStyle = new Style({
  stroke: new Stroke({ color: "#454542", width: 2 }),
  zIndex: 1,
});

/**
 * Which label tier a place gets. Protomaps carries `kind_detail`
 * (country/city/town/village/hamlet/isolated_dwelling) and a `min_zoom` the
 * caller has already checked, so this is only about weight, not about whether
 * to draw at all.
 */
function styleForPlace(feature: FeatureLike): Style | null {
  if (feature.get("kind") === "country") return countryStyle;

  switch (feature.get("kind_detail")) {
    case "country":
      return countryStyle;
    case "region":
      return regionStyle;
    case "city":
      return cityStyle;
    case "town":
      return localityStyle;
    case "village":
      return microLabelStyle;
    case "hamlet":
    case "isolated_dwelling":
      return microLabelStyle;
    default:
      return localityStyle;
  }
}

function placeStyle(feature: FeatureLike, resolution: number): Style | undefined {
  const zoom = zoomFromResolution(resolution);
  if (belowMinZoom(feature, zoom)) return undefined;

  const name = placeName(feature);
  if (!name) return undefined;

  const style = styleForPlace(feature);
  if (!style) return undefined;
  style.getText()!.setText(String(name));
  return style;
}

/** Country borders plus place labels: used where there is no basemap underneath. */
export const bordersAndWays = () => new VectorTileLayer({
  zIndex: 99,
  declutter: true,
  source: protomapsSource(["boundaries", "places"], overlayAttributions),
  style(feature, resolution) {
    switch (feature.get("layer")) {
      case "places":
        return placeStyle(feature, resolution);
      case "boundaries":
        return feature.get("kind") === "country" ? boundaryStyle : undefined;
      default:
        return undefined;
    }
  },
});

/** Place labels only: the basemap already draws its own borders. */
export const labelsOnly = () => {
  const layer = new VectorTileLayer({
    zIndex: 99,
    declutter: true,
    renderMode: "vector",
    source: protomapsSource(["places"], overlayAttributions),
    style(feature, resolution) {
      if (feature.get("layer") !== "places") return undefined;
      return placeStyle(feature, resolution);
    },
  });
  mapBaseLayer.subscribe((baselayer) => {
    layer.setVisible(supportsVectorLabels(baselayer));
  });
  return layer;
};
