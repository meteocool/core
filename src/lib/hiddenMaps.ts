import type Map from "ol/Map";
import { unByKey } from "ol/Observable";

/**
 * Let a map that has been off screen a while give back what it drew with.
 *
 * Every capability has an OpenLayers map of its own, and taking one off the
 * screen -- switching layers, closing the switcher's thumbnails -- leaves
 * everything it drew with in place: a map-sized canvas per group of layers, a
 * WebGL context, a cache of drawn basemap tiles, and for the radar every
 * frame of playback for every network. After a look at each layer that was
 * most of a gigabyte nobody could see.
 *
 * So once a map has had no element for `RELEASE_AFTER_MS`, its layers drop
 * their renderers, which OpenLayers builds again the next time the map is
 * drawn. Its sources stay as they are: features, frames and the basemap's
 * parsed tiles are still there to draw from, and the radar's tiles come back
 * from the HTTP cache. A switch away and straight back stays instant.
 */

export const RELEASE_AFTER_MS = 30_000;

/** Watch `map` from now on; the returned function stops watching. */
export function releaseWhileHidden(map: Map, after = RELEASE_AFTER_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const key = map.on("change:target", () => {
    clearTimeout(timer);
    timer = undefined;
    if (map.getTarget()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (map.getTarget()) return;
      for (const layer of map.getAllLayers()) layer.clearRenderer();
      // The last frame it drew stays on a map with no element to draw the
      // next, and that frame's post-render callbacks hold on to the renderers
      // just let go, tile canvases and all. OpenLayers has no way to say so.
      (map as unknown as { frameState_: unknown }).frameState_ = null;
    }, after);
  });
  return () => {
    clearTimeout(timer);
    unByKey(key);
  };
}
