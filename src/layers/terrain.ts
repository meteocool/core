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
 * Served beside the basemap from map.meteocool.com, out of our own copy of
 * Mapterhorn's archive: the same bytes as their public tiles, versioned by
 * build date like the basemap so a URL never changes content. That copy is
 * their worldwide archive, which ends at zoom 12, 13 m a pixel in the Alps:
 * flying low there, ridges and faces were smooth blurs. Over the Alps the
 * three zooms past it, to 1.7 m, come from Mapterhorn's own tile endpoint,
 * which they offer for this use; see `terrainTileUrl`.
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

/**
 * Which build of the archive; bumped when a newer one is uploaded. Optional
 * chaining because the tests import this module (through the storm layer's
 * `VERTICAL_SCALE`) under Node, where there is no `import.meta.env`.
 */
const TERRAIN_VERSION = import.meta.env?.VITE_TERRAIN_VERSION ?? "20261002";

/** Terrarium-encoded 512px WebP, worldwide, zoom 0 to 12. */
const TERRAIN_TILES = `https://map.meteocool.com/mapterhorn-${TERRAIN_VERSION}/{z}/{x}/{y}.webp`;

/** Where our copy ends: about 20 m a pixel at the equator, 13 m in the Alps. */
export const TERRAIN_COPY_ZOOM = 12;

/**
 * Mapterhorn's own tiles, the same encoding, from national surveys' lidar
 * where there is one: zoom 13 to 17 over much of Europe, a 404 elsewhere.
 * Free to use, commercially too, and to cache, under the source datasets'
 * licences, which the attribution's page lists (mapterhorn.com/faq).
 */
const DEEP_TILES = "https://tiles.mapterhorn.com";

/**
 * Where the tiles stop being fetched; MapLibre overzooms past it. 1.7 m a
 * pixel in the Alps, as sharp as the ground looks from a cockpit a few
 * hundred metres over it. A level more is four times the tiles for detail
 * the satellite imagery draped on it hardly has.
 */
export const TERRAIN_MAX_ZOOM = 15;

/**
 * Where the zooms past our copy are fetched, west, south, east, north: the
 * Alps and their foothills, from the Maritime Alps to Vienna's woods. Every
 * survey there goes to zoom 15 at least. Elsewhere our copy is what there
 * is, which keeps a flight over the plains from asking a free endpoint for
 * tiles it would draw no differently.
 */
export const DEEP_TERRAIN_AREA: readonly [number, number, number, number] = [5.0, 43.6, 16.8, 48.4];

/** The west, south, east and north edges of tile (z, x, y), in degrees. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/**
 * Where tile (z, x, y) is fetched from: our copy to its last zoom, past that
 * Mapterhorn's endpoint over `DEEP_TERRAIN_AREA`, and null where it is not
 * fetched at all, so that MapLibre draws the deepest tile it has.
 */
export function terrainTileUrl(z: number, x: number, y: number): string | null {
  if (z <= TERRAIN_COPY_ZOOM) return TERRAIN_TILES.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`);
  if (z > TERRAIN_MAX_ZOOM) return null;
  const [west, south, east, north] = tileBounds(z, x, y);
  const [areaWest, areaSouth, areaEast, areaNorth] = DEEP_TERRAIN_AREA;
  if (east <= areaWest || west >= areaEast || north <= areaSouth || south >= areaNorth) return null;
  return `${DEEP_TILES}/${z}/${x}/${y}.webp`;
}

/** The URL scheme the 3D map reads the relief through; see `installTerrainProtocol`. */
const TERRAIN_SCHEME = "terrain";

/**
 * What a deep tile that is not there fails with: outside the area, or a 404
 * where a survey stops short. Not a fault: MapLibre falls back to the tile
 * a zoom up, and the 3D map does not ask for it again (`isMissingTerrain`).
 */
const MISSING = "no deeper terrain";

/** Whether a tile's error is only that there is no deeper relief there. */
export function isMissingTerrain(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(MISSING);
}

let protocolInstalled = false;

/** Teach MapLibre `terrain://z/x/y`, once, answered from `terrainTileUrl`. */
export function installTerrainProtocol(maplibre: {
  addProtocol(scheme: string, load: (params: { url: string }, abort: AbortController) => Promise<{ data: unknown }>): void;
}): void {
  if (protocolInstalled) return;
  protocolInstalled = true;
  maplibre.addProtocol(TERRAIN_SCHEME, async (params, abort) => {
    const [z, x, y] = params.url.slice(`${TERRAIN_SCHEME}://`.length).split("/").map(Number);
    const url = terrainTileUrl(z, x, y);
    if (!url) throw new Error(`${MISSING} at ${z}/${x}/${y}`);
    const response = await fetch(url, { signal: abort.signal });
    if (response.status === 404 && z > TERRAIN_COPY_ZOOM) throw new Error(`${MISSING} at ${z}/${x}/${y}`);
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    return { data: await response.arrayBuffer() };
  });
}

/**
 * Under the basemap's first line, over its fills: the water's outlines and
 * the roads over the land and the sea, or the roads over the satellite
 * imagery, which has no rivers drawn.
 */
function hillshadeBefore(gl: GlMap): string | undefined {
  return gl.getStyle().layers.find((layer) => layer.type === "line")?.id;
}

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
 * Idempotent, so it is safe to call from `applyData`, which runs again after
 * every `setStyle`. `setStyle` throws the source, the layer and the terrain
 * away with everything else added on top of the basemap.
 *
 * `drapeSize`, when given, is the side in pixels of the texture each terrain
 * tile is draped with, in place of MapLibre's own; see `gpuBudget.ts`.
 */
export function applyTerrain(gl: GlMap, wanted: boolean, dark: boolean, drapeSize?: number): void {
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
    tiles: [`${TERRAIN_SCHEME}://{z}/{x}/{y}`],
    tileSize: 512,
    encoding: "terrarium",
    maxzoom: TERRAIN_MAX_ZOOM,
    attribution: mapterhornAttribution,
  });
  gl.addLayer(hillshade(dark), hillshadeBefore(gl));
  gl.setTerrain({ source: TERRAIN_SOURCE, exaggeration: VERTICAL_SCALE });
  if (drapeSize) setDrapeSize(gl, drapeSize);
}

/**
 * MapLibre has no option for it: the size is read off the terrain's
 * `RenderToTexture`, made anew by every `setTerrain`, each time a tile's
 * drape is allocated. A MapLibre without that field is left as it is.
 */
function setDrapeSize(gl: GlMap, size: number): void {
  const drapes = (gl as unknown as { painter?: { renderToTexture?: { rttSize?: number } | null } })
    .painter?.renderToTexture;
  if (drapes && typeof drapes.rttSize === "number") drapes.rttSize = size;
}
