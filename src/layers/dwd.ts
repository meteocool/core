import Feature from "ol/Feature";
import Fill from "ol/style/Fill";
import Style from "ol/style/Style";
import TileLayer from "./webglTile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import ValueTileSource, { staleOnlyWhileLoading } from "./valueTiles";
import { blitzortungAttribution, dwdAttribution } from "./attributions";
import { dwdRadarExtent, radarCoverageInv } from "./extents";
import { isDarkBasemap, watchBasemap } from "./casing";
import { tileBaseUrl } from "../urls";
import { trackTileLoads } from "../lib/tileStatus";
import { drawnTileId, rvp6Style } from "../lib/rvp6";
import type { ValueTiles } from "../lib/rvp6";
import { hgClassStyle } from "../lib/hgClasses";
import type { ClassTiles } from "../api";
import { NOWCAST_OPACITY } from "./ui";
import { radarTileCache } from "../lib/gpuBudget";

/** What a layer is built for: one frame's tile set, and what its bytes mean. */
export interface TileFrame {
  tile_id: string;
  bucket?: string;
  values?: ValueTiles | null;
}

/** The palette DWD's frames are drawn in, by the name the settings store it under. */
let palette = "classic";

// Zoom 9 for the observed frame, HX at 250 m; a forecast step is WN at 1 km
// and stops at 8, and answers 9 out of its own 8 (lib/tileIndex.ts). The
// server serves 512 px tiles, and `interpolate: false` keeps every radar
// pixel a square of its own class.
const commonDWDParameters = {
  attributions: [dwdAttribution, blitzortungAttribution],
  minZoom: 3,
  maxZoom: 9,
  tileSize: 512,
  transition: 0,
  interpolate: false,
};

/**
 * The tile URL for a `RadarFrame`-shaped `{tile_id}` in one bucket.
 *
 * Shared by every network's reflectivity layer: DWD's and the EUMETNET ones
 * alike hand the client the same `RadarFrame` shape, so this is the one place
 * that turns it into a tile source URL.
 * A frame's value tiles are at the same place, under `values.tile_id`.
 */
export const tileSourceUrl = (bucket: string, tileId: string) =>
  `${tileBaseUrl}/${bucket}/${tileId}/{z}/{x}/{-y}.png`;

/** The value layers built, so a palette change restyles them in place. */
const valueLayers = new Set<TileLayer>();

/**
 * The layer DWD's frames are drawn through, built on one of them.
 *
 * Playback re-points its source at every step (`ValueTileSource.setUrl`),
 * which also cuts the EUMETNET networks' countries out of the observed
 * steps those networks have frames for: see `networkHoles.ts` for why. The
 * palette is the layer's style, a 256-entry lookup on the GPU, the same
 * cost in every palette.
 */
export function dwdValueLayer(frame: TileFrame): [TileLayer, ValueTileSource, string] {
  const tileId = drawnTileId(frame);
  const url = tileSourceUrl(frame.bucket ?? "meteoradar", tileId);
  const source = trackTileLoads(new ValueTileSource({ ...commonDWDParameters, url, holed: true }));
  source.set("tile_id", tileId);
  const layer = staleOnlyWhileLoading(new TileLayer({
    source,
    style: rvp6Style(palette),
    zIndex: 80,
    opacity: NOWCAST_OPACITY,
    cacheSize: radarTileCache(512),
    extent: dwdRadarExtent,
  }));
  layer.set("tile_id", tileId);
  valueLayers.add(layer);
  return [layer, source, url];
}

export function setDwdCmap(colorMapString: string) {
  palette = colorMapString;
  for (const layer of valueLayers) {
    // Disposed: OpenLayers takes the source away.
    if (!layer.getSource()) valueLayers.delete(layer);
    else layer.setStyle(rvp6Style(palette));
  }
}

/** The dark wash over everywhere neither radar network reaches. */
/**
 * How hard the "no radar here" wash is laid on, by what it is laid on.
 *
 * It is a black wash, so its strength has to follow the basemap: a tenth of
 * black over the light earth (#f6f4f0) is an obvious step down, and the same
 * tenth over the dark one (#1c1f24) is almost nothing. That left the boundary
 * between "no radar" and "no rain" invisible on exactly the basemap where the
 * distinction matters most, because both read as dark.
 *
 * Nearly a quarter in the dark, against a tenth in the light. The jump is
 * bigger than it looks: against a near-black ground an absolute step of a few
 * levels is a large relative one, and going further turns unsupported regions
 * into holes in the page instead of quieter map.
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

/**
 * The precipitation-type layer for its newest frame: a byte per HG class
 * (lib/hgClasses.ts), coloured on the GPU.
 */
export const dwdPrecipTypes = (frame: { tile_id: string; values?: ClassTiles | null }, bucket = "meteoradar") => {
  const source = trackTileLoads(new ValueTileSource({
    url: tileSourceUrl(bucket, frame.values?.tile_id ?? frame.tile_id),
    attributions: [dwdAttribution],
    minZoom: 3,
    maxZoom: 8,
    transition: 300,
    tileSize: 512,
    // Classes, not intensities: blending snow into hail past zoom 8 draws a colour no class has.
    interpolate: false,
  }));
  return staleOnlyWhileLoading(new TileLayer({ source, style: hgClassStyle(), zIndex: 3, opacity: NOWCAST_OPACITY, cacheSize: radarTileCache(256) }));
};
