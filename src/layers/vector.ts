import VectorTileLayer from "ol/layer/VectorTile";
import { Stroke, Style, Fill, Text } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import {
  imprintAttribution,
  osmAttribution,
  protomapsAttribution,
} from "./attributions";
import { mapBaseLayer } from "../stores";
import { supportsVectorLabels } from "./base";
import { isDarkBasemap, watchBasemap } from "./casing";
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

/**
 * A label's colours, picked to match whatever is drawn underneath it.
 *
 * The halo is always the basemap's own colour, softened -- never a contrasting
 * one. Labels crowd, and at 11px the halo of one glyph merges into its
 * neighbours and into the counters of a, e and o. A halo in the basemap's
 * colour that merges just disappears back into the map; a contrasting one
 * merges into a plate. That is what the old black-on-opaque-white labels did
 * over the dark basemap: the white halo was the only part of the label with
 * any contrast against #1c1f24, so a cluster of village names read as a bright
 * smear with black holes punched in it rather than as type. Same rule the
 * casings follow in ./casing -- match the background, don't fight it.
 */
interface LabelPalette {
  /** Country, region and city. */
  ink: string;
  /** Town, village and hamlet: a step back, so the tiers part by luminance. */
  mutedInk: string;
  halo: string;
  /** Multiplier on the tier halo widths, for backdrops that need more. */
  haloScale: number;
}

/**
 * Near-black and near-white rather than the pure endpoints: #000 on #f6f4f0,
 * or #fff on #1c1f24, is more contrast than small type wants and makes it buzz.
 *
 * The muted step is deliberately small. These labels sit over *radar*, not
 * over the basemap, and reflectivity runs the whole luminance range -- so a
 * muted ink picked as a step back from the earth colour collapses the moment
 * the town lands on a green or yellow cell, which at this zoom is most of the
 * interesting ones. Size and weight carry the hierarchy; the ink only has to
 * hint at it.
 */
const lightLabels: LabelPalette = {
  ink: "#1b1e23",
  mutedInk: "#3a4048",
  halo: "rgba(246, 244, 240, 0.85)",
  haloScale: 1,
};

const darkLabels: LabelPalette = {
  ink: "#eef1f5",
  mutedInk: "#ccd3dc",
  halo: "rgba(28, 31, 36, 0.85)",
  haloScale: 1,
};

/**
 * Satellite is the one backdrop no basemap colour stands in for: cloud tops
 * and snow come out brighter than any of the themes, so the halo has to work
 * harder to hold a light label off them.
 */
const satelliteLabels: LabelPalette = {
  ...darkLabels,
  halo: "rgba(20, 23, 28, 0.92)",
  haloScale: 1.3,
};

function paletteFor(basemap: string): LabelPalette {
  if (basemap === "satellite") return satelliteLabels;
  return isDarkBasemap(basemap) ? darkLabels : lightLabels;
}

/**
 * One Text style per tier: labels are decluttered against each other, so the
 * style is mutated per feature and consumed straight away. The Fill and Stroke
 * are held alongside it because the palette is applied by mutating them in
 * place -- every layer holds a reference to the same Style, so rebuilding it
 * would leave them all pointing at the old one.
 */
interface LabelTier {
  fill: Fill;
  stroke: Stroke;
  /** Tiers below city take the palette's muted ink. */
  muted: boolean;
  haloWidth: number;
}

const tiers: LabelTier[] = [];

/**
 * OpenLayers strokes the glyph outline centred on it and then fills over the
 * top, so the halo you actually see is half of `haloWidth`.
 *
 * These ran 4 / 3 / 3 / 2 / 1.5, which made halo thickness part of the
 * hierarchy -- widest on the largest type, thinnest on the smallest. That was
 * backwards twice over: size and weight already carry the hierarchy, and it is
 * the small labels that most need lifting off a busy cell. They are uniform
 * now bar the country tier. Thinning them at 11px was only ever a defence
 * against the halo merging across letterforms, and a halo the colour of what
 * is behind it can merge all it likes.
 */
function labelStyle(font: string, haloWidth: number, zIndex: number, muted = false) {
  const fill = new Fill({ color: lightLabels.ink });
  const stroke = new Stroke({ color: lightLabels.halo, width: haloWidth });
  tiers.push({ fill, stroke, muted, haloWidth });
  return new Style({
    text: new Text({
      font,
      fill,
      overflow: true,
      stroke,
    }),
    zIndex,
  });
}

const countryStyle = labelStyle("bold 18px Calibri,sans-serif", 2.6, 100);
const regionStyle = labelStyle("16px Calibri,sans-serif", 2.2, 90);
const cityStyle = labelStyle("bold 13px Calibri,sans-serif", 2.2, 92);
const localityStyle = labelStyle("12px Calibri,sans-serif", 2.0, 90, true);
const microLabelStyle = labelStyle("11px Calibri,sans-serif", 2.0, 88, true);

/**
 * Every live label layer, so one basemap change repaints all of them.
 *
 * This is also why the subscriptions below are module-level rather than one
 * per layer: the factories are called five times between them from the
 * capability descriptors in App.svelte, and each call used to open a
 * mapBaseLayer subscription that nothing ever released.
 */
const labelLayers = new Set<VectorTileLayer>();

function applyPalette(palette: LabelPalette) {
  tiers.forEach((tier) => {
    tier.fill.setColor(tier.muted ? palette.mutedInk : palette.ink);
    tier.stroke.setColor(palette.halo);
    tier.stroke.setWidth(tier.haloWidth * palette.haloScale);
  });
  // OpenLayers caches rendered vector-tile text, and the tier styles are shared
  // singletons it has no way to notice the mutation of: without this the old
  // colours stay on screen until something else invalidates the layer.
  labelLayers.forEach((layer) => layer.changed());
}

watchBasemap(paletteFor, applyPalette);

/** The basemap as last seen, so a layer built later starts out correct. */
let currentBasemap = "light";

mapBaseLayer.subscribe((baselayer) => {
  currentBasemap = String(baselayer);
  labelLayers.forEach((layer) => {
    if (layer.get("followsBasemapVisibility")) {
      layer.setVisible(supportsVectorLabels(currentBasemap));
    }
  });
});

/** Register a freshly built layer with the palette and visibility subscriptions. */
function trackLabels(layer: VectorTileLayer, followsBasemapVisibility = false): VectorTileLayer {
  layer.set("followsBasemapVisibility", followsBasemapVisibility);
  labelLayers.add(layer);
  if (followsBasemapVisibility) {
    layer.setVisible(supportsVectorLabels(currentBasemap));
  }
  return layer;
}

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

  const name = feature.get("name:de") ?? feature.get("name");
  if (!name) return undefined;

  const style = styleForPlace(feature);
  if (!style) return undefined;
  style.getText()!.setText(String(name));
  return style;
}

/** Country borders plus place labels: used where there is no basemap underneath. */
export const bordersAndWays = () => trackLabels(new VectorTileLayer({
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
}));

/** Place labels only: the basemap already draws its own borders. */
export const labelsOnly = () => trackLabels(new VectorTileLayer({
  zIndex: 99,
  declutter: true,
  renderMode: "vector",
  source: protomapsSource(["places"], overlayAttributions),
  style(feature, resolution) {
    if (feature.get("layer") !== "places") return undefined;
    return placeStyle(feature, resolution);
  },
}), true);
