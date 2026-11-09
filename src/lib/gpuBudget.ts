/**
 * What the maps may hold in memory, which on a phone is far less than on a
 * desktop: mostly the 3D map's GPU textures, and the flat map's radar tiles.
 *
 * iOS kills an app's web content process once it passes 2 GB, WebGL included,
 * and the app reloads the page: on an iPhone 16 Pro that happened every few
 * pans and zooms in the 3D map (October 2026). Measured at that phone's
 * viewport, the 3D map held 600 MB of WebGL on opening and peaked past 1 GB
 * while being moved, most of it the textures MapLibre drapes over the terrain.
 * A desktop browser has the room, so only handheld devices are held back.
 */
import { DeviceDetect as dd } from "./DeviceDetect";

/**
 * The layer types MapLibre draws into a texture and drapes over the terrain.
 * Every run of them between two layers that stand up (extrusions, the storm
 * volumes, circles, labels) is a texture of its own for every terrain tile.
 */
const DRAPED = new Set(["background", "fill", "line", "raster", "hillshade", "color-relief"]);

/** The canvas's pixel ratio on a handheld device: a phone's 3x is 2.25 times the pixels of 2x. */
const HANDHELD_PIXEL_RATIO = 2;

/**
 * The side of the texture each terrain tile is draped with on a handheld
 * device, in pixels. MapLibre's own is twice its 1024-pixel terrain tile,
 * about 21 MB per tile with its mipmaps; this is a quarter of that.
 */
export const HANDHELD_DRAPE_SIZE = 1024;

/**
 * How many zoom levels of tiles MapLibre keeps off screen on a handheld
 * device. Its default, 5, keeps up to 30 tiles per source at a phone's
 * viewport, for each of the basemap, the terrain and every radar network.
 */
export const HANDHELD_TILE_CACHE_ZOOM_LEVELS = 1;

/** A megabyte, in bytes. */
const MB = 1024 * 1024;

/** The side of a radar tile of the flat map, in pixels. */
export const RADAR_TILE_SIZE = 512;

/**
 * The bytes one radar tile holds, in JavaScript and as much again on the GPU:
 * a byte a pixel and band. Packed (layers/packTiles.ts), a tile is one band,
 * its values, or two at the antialiased edge of a network's ground.
 */
export function tileBytes(bands = 1, size = RADAR_TILE_SIZE): number {
  return size * size * bands;
}

/** A packed radar tile, the common case, in bytes. */
export const RADAR_TILE_BYTES = tileBytes(1);

/**
 * What each radar layer of the flat map may keep in tiles on a handheld
 * device, in bytes of values (each has its texture beside it).
 *
 * Playback keeps the tiles of every step it has shown, so a loop never
 * fetches or decodes them twice. A tile is a quarter of a megabyte of values
 * in JavaScript and as much again on the GPU, and DWD and every network keep
 * their own. At 512 tiles a layer, a few loops held over a gigabyte on an
 * iPhone 16 Pro, and opening the 3D map on top of that passed iOS's 2 GB for
 * a web view (October 2026). 32 MB, 128 tiles, is about six frames of a
 * phone's screen; the frames past those come from the decoded tiles
 * (`decodedTileBytes`) or are read again.
 */
const HANDHELD_RADAR_LAYER_BYTES = 32 * MB;

/** How many tiles each radar layer of the flat map keeps on a handheld device. */
export const HANDHELD_RADAR_TILE_CACHE = HANDHELD_RADAR_LAYER_BYTES / RADAR_TILE_BYTES;

/**
 * What all the radar layers a flat map draws keep between them on a handheld
 * device (lib/idleLayers.ts), in bytes of values. Over Central Europe a
 * phone's screen draws DWD, a few networks and their nowcasts at once, each
 * keeping up to its own 32 MB: a thousand tiles, half a gigabyte of
 * textures, while playing and zooming (October 2026).
 */
const HANDHELD_RADAR_SHARED_BYTES = 80 * MB;

/** How many radar tiles all the layers a flat map draws keep between them on a handheld device. */
export const HANDHELD_RADAR_TILES = HANDHELD_RADAR_SHARED_BYTES / RADAR_TILE_BYTES;

/**
 * What each radar layer of the flat map may keep on a desktop, in bytes of
 * values: 640 tiles, a little more than a full loop of a laptop's screen
 * needs of DWD's at most zooms, beside the decoded tiles.
 */
const DESKTOP_RADAR_LAYER_BYTES = 160 * MB;

/** How many tiles each radar layer of the flat map keeps on a desktop. */
export const DESKTOP_RADAR_TILE_CACHE = DESKTOP_RADAR_LAYER_BYTES / RADAR_TILE_BYTES;

/** The `cacheSize` of a radar layer of the flat map that keeps `desktop` tiles on a desktop. */
export function radarTileCache(desktop = DESKTOP_RADAR_TILE_CACHE, handheld = isHandheld()): number {
  return handheld ? Math.min(desktop, HANDHELD_RADAR_TILE_CACHE) : desktop;
}

/**
 * The most bytes of tiles decoded ahead of playback (lib/decodedTiles.ts).
 *
 * Each is the same allocation OpenLayers is handed, so a tile both hold
 * costs once; past that, this is what playback adds, with no texture of its
 * own. On a phone, 32 MB: eight to a dozen frames of its screen ahead of the
 * needle, a few seconds of the loop, and what the layers keep on the GPU
 * covers much of the rest. Its peaks are what iOS judges the web view by,
 * and decoding further ahead buys little a few seconds cannot. On a
 * desktop, most of a loop at a laptop's screen.
 */
export function decodedTileBytes(handheld = isHandheld()): number {
  return handheld ? 32 * MB : 256 * MB;
}

/**
 * How many tiles are loaded and decoded ahead at once (lib/framePreload.ts):
 * on a phone two, one for each of its workers, so the frame on screen is
 * not kept waiting behind them and the decoding's garbage comes no faster
 * than it is collected; on a desktop four.
 */
export function decodeAheadParallel(handheld = isHandheld()): number {
  return handheld ? 2 : 4;
}

/**
 * How many workers decode value tiles (layers/packTiles.ts): two on a phone,
 * whose cores the page and the GPU need as well; on a desktop, one per core
 * to spare, up to four.
 */
export function decodeWorkers(cores: number | undefined, handheld = isHandheld()): number {
  if (handheld || !cores) return 2;
  return Math.max(2, Math.min(4, cores - 1));
}

/** A phone or a tablet: an app's webview, or a browser that is touched and cannot hover. */
export function isHandheld(): boolean {
  if (dd.isApp()) return true;
  if (typeof window === "undefined") return false;
  return Boolean(window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(hover: hover)").matches);
}

/**
 * The pixel ratio to draw the 3D map at: the screen's own, except on a
 * handheld device whose reader has not asked for full resolution
 * (`fullResolution3d`).
 */
export function mapPixelRatio(devicePixelRatio: number, handheld: boolean, fullResolution = false): number {
  return handheld && !fullResolution ? Math.min(devicePixelRatio, HANDHELD_PIXEL_RATIO) : devicePixelRatio;
}

/**
 * The layer a layer that lies on the ground goes before, so that it shares
 * the draped texture of the layers under it rather than starting another:
 * the first one that stands up. Undefined when none does yet.
 */
export function drapeAnchor(layers: readonly { id: string; type: string }[]): string | undefined {
  return layers.find((layer) => !DRAPED.has(layer.type))?.id;
}
