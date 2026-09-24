 
import Feature from "ol/Feature";
import Fill from "ol/style/Fill";
import Style from "ol/style/Style";
import TileLayer from "ol/layer/WebGLTile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import ImageTileSource from "ol/source/ImageTile";
import NetworkHoleTileSource from "./networkHoles";
import { blitzortungAttribution, dwdAttribution } from "./attributions";
import { dwdRadarExtent, radarCoverageInv } from "./extents";
import { isDarkBasemap, watchBasemap } from "./casing";
import { tileBaseUrl } from "../urls";
import { trackTileLoads } from "../lib/tileStatus";
import type BaseLayer from "ol/layer/Base";

/**
 * Builds the layer and source for one radar tile set, plus the URL template.
 * RadarCapability swaps between these when the colormap changes.
 */
export type LayerFactory = (tileId: string, bucket?: string) => [BaseLayer, NetworkHoleTileSource, string];
import { NOWCAST_OPACITY } from "./ui";
import { cmapFromString } from "../lib/cmap_utils";
import { RVP6_CLASSIC }  from "../colormaps";

let cmap = RVP6_CLASSIC;

// OpenLayers 10 renders WebGLTile layers from DataTile sources only, so these
// moved onto ol/source/ImageTile. Three of the old options went with that:
// `imageSmoothing: false` is now `interpolate: false`, `cacheSize` belongs on
// the layer rather than the source, and `tilePixelRatio` no longer exists --
// ImageTile's `tileSize` *is* the source image size, and the server really does
// serve 512px tiles, so the retina-doubled ratio was declaring them as 1024.
const commonDWDParameters = {
  attributions: [dwdAttribution, blitzortungAttribution],
  crossOrigin: "anonymous" as const,
  minZoom: 3,
  maxZoom: 8,
  tileSize: 512,
  transition: 0,
  interpolate: false,
};

/**
 * The tile URL for a `RadarFrame`-shaped `{tile_id}` in one bucket.
 *
 * Shared by every network's reflectivity layer -- DWD's and the EUMETNET ones alike
 * hand the client the same `RadarFrame` shape, so this is the one place that
 * turns it into a tile source URL rather than each layer hand-rolling its own.
 */
export const tileSourceUrl = (bucket: string, tileId: string) =>
  `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;

/**
 * The tile source for one DWD tile set.
 *
 * The live observation's tiles come back with Switzerland and France erased,
 * so that those networks' own layers are the only radar drawn over their
 * ground -- see `networkHoles.ts` for why the holes are cut into the images
 * rather than clipped at render time. Every other step is left whole: those
 * layers show only the live frame, so DWD is all there is for the rest.
 */
export const dwdSource = (tileId: string, bucket = "meteoradar") => {
  // Always this source: playback re-points one source across every step, so
  // which tiles get holes is decided per URL there.
  const reflectivitySource = trackTileLoads(new NetworkHoleTileSource({
    ...commonDWDParameters,
    url: tileSourceUrl(bucket, tileId),
  }));
  reflectivitySource.set("tile_id", tileId);
  return reflectivitySource;
};

export const dwdLayerStatic: LayerFactory = (tileId, bucket) => {
  const reflectivitySource = dwdSource(tileId, bucket);
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 80,
    opacity: NOWCAST_OPACITY,
    cacheSize: 512,
    extent: dwdRadarExtent,
  });

  reflectivityLayer.set("tile_id", tileId);
  return [reflectivityLayer, reflectivitySource, ""];
};

export const DWDLayerFactoryGL: LayerFactory = (tileId, bucket = "meteoradar") => {
  const sourceUrl = tileSourceUrl(bucket, tileId);
  // Through `dwdSource` rather than its own source, so this colour scheme gets
  // Switzerland cut out of it exactly as the classic one does.
  const reflectivitySource = dwdSource(tileId, bucket);

  const toColorId = [
    "+",
    ["*", 255 * 256 * 256, ["band", 1]],
    ["+", ["*", 255 * 256, ["band", 2]], ["*", 255, ["band", 3]]],
  ];

  const indexes = RVP6_CLASSIC.map((rgba) => {
    const [r, g, b, _] = rgba;
    return (r * 256 * 256) + (g * 256) + b;
  });

  const cmapAlphaNorm = cmap.map((color) => [color[0], color[1], color[2], color[3] / 255]);
  const matches = indexes.map((element, index) => [element, cmapAlphaNorm[index]]).flat();

  const reflectivityLayer = new TileLayer({
    zIndex: 3,
    cacheSize: 512,
    opacity: NOWCAST_OPACITY,
    source: reflectivitySource,
    extent: dwdRadarExtent,
    style: {
      color: [
        "match",
        toColorId,
        ...matches,
        [255, 0, 0, 0],
      ],
    },
  });
  reflectivityLayer.set("tileId", tileId);
  return [reflectivityLayer, reflectivitySource, sourceUrl];
};

export function setDwdCmap(colorMapString: string) {
  [cmap] = cmapFromString(colorMapString);
}

/** The dark wash over everywhere neither radar network reaches. */
/**
 * How hard the "no radar here" wash is laid on, by what it is laid on.
 *
 * It is a black wash, so its strength has to follow the basemap: a tenth of
 * black over the light earth (#f6f4f0) is an obvious step down, and the same
 * tenth over the dark one (#1c1f24) is almost nothing -- which left the
 * boundary between "no radar" and "no rain" invisible on exactly the basemap
 * where the distinction matters most, because both read as dark.
 *
 * Nearly a quarter in the dark, rather than a tenth. That is a much bigger
 * jump than it looks: against a near-black ground an absolute step of a few
 * levels is a large relative one, and going further turns unsupported regions
 * into holes in the page rather than into quieter map.
 */
const WASH_LIGHT = "rgba(0, 0, 0, 0.1)";
const WASH_DARK = "rgba(0, 0, 0, 0.24)";

const washFor = (basemap: string): string => (isDarkBasemap(basemap) ? WASH_DARK : WASH_LIGHT);

/**
 * The one Fill every coverage wash shares, and the layers drawing it.
 *
 * Mutated in place rather than rebuilt, for the same reason the place labels
 * are: the factory is called once per capability and each call's layer holds a
 * reference to the Style, so replacing it would leave all but one of them
 * pointing at the old colour. One module-level subscription rather than one
 * per layer, so nothing has to be unsubscribed.
 */
const washFill = new Fill({ color: WASH_LIGHT });
const washLayers = new Set<VectorLayer>();

watchBasemap(washFor, (colour) => {
  washFill.setColor(colour);
  // OpenLayers has no way to notice a mutated style; without this the old
  // wash stays on screen until something else invalidates the layer.
  washLayers.forEach((layer) => layer.changed());
});

export const radolanOverlay = () => {
  const layer = new VectorLayer({
    zIndex: 1000,
    renderBuffer: 500,
    source: new VectorSource({
      features: [
        new Feature({
          geometry: radarCoverageInv,
          name: "DarkOverlay",
        }),
      ],
    }),
    style: new Style({ fill: washFill }),
  });
  washLayers.add(layer);
  return layer;
};

export const dwdPrecipTypes = (tileId, bucket = "meteoradar") => {
  const sourceUrl = `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;
  const reflectivitySource = trackTileLoads(new ImageTileSource({
    url: sourceUrl,
    attributions: [dwdAttribution],
    crossOrigin: "anonymous",
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tileSize: 512,
  }));
  const reflectivityLayer = new TileLayer({
    source: reflectivitySource,
    zIndex: 3,
    opacity: NOWCAST_OPACITY,
    cacheSize: 256,
  });
  return reflectivityLayer;
};
