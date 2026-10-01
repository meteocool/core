/**
 * The ground's relief under the 3D map: Mapterhorn's elevation tiles, raised
 * into terrain and shaded.
 *
 * Raised by `VERTICAL_SCALE`, the same as the storms. The volumes are built in
 * metres above sea level and stand on z = 0, so the one stretch applied to
 * both keeps a storm over the Alps on the mountains rather than in them or
 * above them. MapLibre's exaggeration scales the terrain alone, not a custom
 * layer, which is why the storm layer applies it itself.
 *
 * Mapterhorn's own public tiles for now; the URL is the one thing to change
 * when they are hosted beside the basemap.
 */
import type { HillshadeLayerSpecification, Map as GlMap } from "maplibre-gl";
import { mapterhornAttribution } from "./attributions";

/**
 * How much taller than life the 3D map draws heights: the storms, the cells
 * and the ground alike. At true scale a 12 km storm is a low dome on 40 km of
 * map seen from far enough to frame it, and the relief of most of Europe is
 * invisible; at 2x the storms read as columns. 1.5 is where both still look
 * like what they are.
 */
export const VERTICAL_SCALE = 1.5;

const TERRAIN_SOURCE = "terrain";
const HILLSHADE_LAYER = "hillshade";

/** Terrarium-encoded 512px WebP, worldwide. */
const TERRAIN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

/**
 * Where the tiles stop being fetched; MapLibre overzooms past it. About 20 m
 * a pixel, finer than a 250 m radar voxel by far, and every level more is
 * four times the tiles on a phone's connection.
 */
const TERRAIN_MAX_ZOOM = 12;

/** Under the water's outlines and the roads, over the land and the sea. */
const HILLSHADE_BEFORE = "waterway";

function hillshade(dark: boolean): HillshadeLayerSpecification {
  return {
    id: HILLSHADE_LAYER,
    type: "hillshade",
    source: TERRAIN_SOURCE,
    // Faint: the relief reads under the radar without competing with it.
    paint: dark
      ? {
        "hillshade-shadow-color": "rgba(0, 0, 0, 0.45)",
        "hillshade-highlight-color": "rgba(255, 255, 255, 0.06)",
        "hillshade-accent-color": "rgba(0, 0, 0, 0.2)",
        "hillshade-exaggeration": 0.35,
      }
      : {
        "hillshade-shadow-color": "rgba(60, 50, 40, 0.32)",
        "hillshade-highlight-color": "rgba(255, 255, 255, 0.35)",
        "hillshade-accent-color": "rgba(60, 50, 40, 0.15)",
        "hillshade-exaggeration": 0.3,
      },
  };
}

/**
 * Put the relief on the map, or take it off.
 *
 * Idempotent, so it is safe from `applyData`, which runs again after every
 * `setStyle` -- and that throws the source, the layer and the terrain away
 * with everything else added on top of the basemap.
 */
export function applyTerrain(gl: GlMap, wanted: boolean, dark: boolean): void {
  const present = Boolean(gl.getSource(TERRAIN_SOURCE));
  if (!wanted) {
    if (!present) return;
    gl.setTerrain(null);
    if (gl.getLayer(HILLSHADE_LAYER)) gl.removeLayer(HILLSHADE_LAYER);
    gl.removeSource(TERRAIN_SOURCE);
    return;
  }
  if (present) return;
  gl.addSource(TERRAIN_SOURCE, {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    tileSize: 512,
    encoding: "terrarium",
    maxzoom: TERRAIN_MAX_ZOOM,
    attribution: mapterhornAttribution,
  });
  gl.addLayer(hillshade(dark), gl.getLayer(HILLSHADE_BEFORE) ? HILLSHADE_BEFORE : undefined);
  gl.setTerrain({ source: TERRAIN_SOURCE, exaggeration: VERTICAL_SCALE });
}
