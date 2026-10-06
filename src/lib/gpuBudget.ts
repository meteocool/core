/**
 * What the 3D map may spend on the GPU, which on a phone is far less than on
 * a desktop.
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
