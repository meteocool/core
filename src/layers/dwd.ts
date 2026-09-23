 
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
export const radolanOverlay = () => new VectorLayer({
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
  style: new Style({
    fill: new Fill({
      color: "rgba(0, 0, 0, 0.1)",
    }),
  }),
});

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
