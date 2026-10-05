import VectorTileLayer from "ol/layer/VectorTile";
import { Stroke, Style, Fill, Text } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import { locale } from "svelte-i18n";
import { placeNameForLocale } from "./placeName";
import { chooseLocale } from "../locale/choose";
import {
  imprintAttribution,
  osmAttribution,
  protomapsAttribution,
} from "./attributions";
import { mapBaseLayer } from "../stores";
import { supportsVectorLabels } from "./base";
import { isDarkBasemap, watchBasemap } from "./casing";
import { belowMinZoom, protomapsSource, zoomFromResolution } from "./protomaps";
import {
  darkLabels, LABEL_FAMILY, LABEL_TIERS, lightLabels, satelliteLabels, tierOfPlace,
} from "./labels";
import type { LabelPalette, LabelTier, LabelTierName } from "./labels";

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
/* Place names in the frontend's language (see src/locale/choose.ts), and
   again when an app tells us its language after the map is up: the label
   layers are redrawn once the store has moved, further down. */
let placeName = placeNameForLocale(chooseLocale());

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
interface TierPaint {
  fill: Fill;
  stroke: Stroke;
  /** Tiers below city take the palette's muted ink. */
  muted: boolean;
  haloWidth: number;
}

const tiers: TierPaint[] = [];

/**
 * A tier's style; see ./labels for the tiers, and for why the halos are as
 * they are.
 */
function labelStyle({ size, bold, halo, rank, muted }: LabelTier) {
  const fill = new Fill({ color: lightLabels.ink });
  const stroke = new Stroke({ color: lightLabels.halo, width: halo });
  tiers.push({ fill, stroke, muted, haloWidth: halo });
  return new Style({
    text: new Text({
      font: `${bold ? "bold " : ""}${size}px ${LABEL_FAMILY},sans-serif`,
      fill,
      overflow: true,
      stroke,
    }),
    zIndex: rank,
  });
}

const tierStyles = Object.fromEntries(
  Object.entries(LABEL_TIERS).map(([name, tier]) => [name, labelStyle(tier)]),
) as Record<LabelTierName, Style>;

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

locale.subscribe((tag) => {
  if (!tag) return;
  placeName = placeNameForLocale(tag);
  labelLayers.forEach((layer) => layer.changed());
});

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

/** Which label tier a place gets; see `tierOfPlace`. */
function styleForPlace(feature: FeatureLike): Style {
  return tierStyles[tierOfPlace(feature.get("kind"), feature.get("kind_detail"))];
}

function placeStyle(feature: FeatureLike, resolution: number): Style | undefined {
  const zoom = zoomFromResolution(resolution);
  if (belowMinZoom(feature, zoom)) return undefined;

  const name = placeName(feature);
  if (!name) return undefined;

  const style = styleForPlace(feature);
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
