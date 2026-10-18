import type Map from "ol/Map";
import type BaseLayer from "ol/layer/Base";
import type { FrameState } from "ol/Map";
import { inView } from "ol/layer/Layer";
import { intersects } from "ol/extent";
import WebGLTileLayer from "ol/layer/WebGLTile";
import VectorTileLayer from "ol/layer/VectorTile";
import { unByKey } from "ol/Observable";

/**
 * Let the radar layers a map is not drawing give back what they hold, and
 * those it draws share one budget of tiles.
 *
 * The radar map has a WebGL layer for DWD, for every network, every
 * network's nowcast and every product, and each keeps its tiles, a
 * screen-sized target and a depth buffer from the first frame it draws until
 * the page closes, drawn or not: hidden behind another product, past a
 * forecast's end, or a country away. Played through while zooming on an
 * iPhone, two dozen such layers held over a gigabyte (October 2026).
 *
 * So a layer the map has not drawn for `after` while drawing others drops
 * its renderer, which OpenLayers builds again when it is next drawn, from the
 * HTTP cache. A layer taken off the map drops it at once. And with a
 * `budget`, the layers being drawn split that many tiles between them,
 * however many there are.
 *
 * With a budget, the basemap keeps fewer drawn tiles too. OpenLayers keeps
 * twice as many as the widest view has wanted, and never fewer again: a tile
 * is a 9 MB canvas at an iPhone's 3x, and one look at Europe left 40 of them
 * (October 2026). It keeps what the view wants now and a few more.
 */

/** How long a layer may go undrawn, while its map draws, before it lets go. */
export const IDLE_AFTER_MS = 20_000;

/** The fewest tiles a layer keeps under a budget, whatever it shows. */
export const MIN_LAYER_TILES = 8;

/** The layers last drawn more than `after` before the map's last frame, `now`. */
export function idleLayers<K>(lastDrawn: ReadonlyMap<K, number>, now: number, after = IDLE_AFTER_MS): K[] {
  return [...lastDrawn].filter(([, at]) => now - at > after).map(([layer]) => layer);
}

/**
 * How many tiles a layer may keep: its share of `budget` among `layers`, but
 * room for twice the `shown` frame's tiles whatever the share, so the frame
 * on screen and the one before it, standing in while the next loads, are
 * never pushed out; and never more than it had (`own`).
 */
export function tileShare(budget: number, layers: number, own: number, shown = 0): number {
  return Math.min(own, Math.max(MIN_LAYER_TILES, 2 * shown, Math.floor(budget / Math.max(1, layers))));
}

/** How many drawn tiles past those in view a basemap layer keeps under a budget. */
export const BASEMAP_TILE_MARGIN = 4;

/** The drawn tiles a basemap layer keeps when its view wants `wanted`. */
export function basemapTiles(wanted: number): number {
  return wanted + BASEMAP_TILE_MARGIN;
}

/** Whether a frame draws this layer: shown, at this zoom, and over the frame's ground. */
function drawn(state: FrameState["layerStatesArray"][number], frameState: FrameState): boolean {
  if (!inView(state, frameState.viewState)) return false;
  return !state.extent || intersects(state.extent, frameState.extent!);
}

interface TileCacheInternals {
  helper?: unknown;
  updateCacheSize?(wanted: number): void;
  tileRepresentationCache?: {
    highWaterMark: number;
    getCount(): number;
    getValues(): Array<{ tile: { key: string } }>;
  };
  tileCache_?: { highWaterMark: number };
}

/**
 * Whether a layer's renderer holds anything: a context and its target, or
 * tiles. OpenLayers makes an empty one again for every shown layer, in view
 * or not, each time it checks whether the map is still loading.
 */
function holds(layer: WebGLTileLayer): boolean {
  if (!layer.hasRenderer()) return false;
  const renderer = layer.getRenderer() as unknown as TileCacheInternals;
  return Boolean(renderer.helper) || (renderer.tileRepresentationCache?.getCount() ?? 0) > 0;
}

/**
 * Size a canvas tile layer's cache to what its view wants, once per renderer.
 * OpenLayers asks `updateCacheSize` after every complete frame, then lets go
 * of the oldest tiles past it.
 */
function fitTileCache(layer: VectorTileLayer, fitted: WeakSet<object>): void {
  if (!layer.hasRenderer()) return;
  const renderer = layer.getRenderer() as unknown as TileCacheInternals;
  const cache = renderer.tileCache_;
  if (!cache || !renderer.updateCacheSize || fitted.has(renderer)) return;
  fitted.add(renderer);
  renderer.updateCacheSize = (wanted) => { cache.highWaterMark = basemapTiles(wanted); };
}

/** Watch `map`'s WebGL tile layers from now on; the returned function stops watching. */
export function releaseIdleLayers(map: Map, { after = IDLE_AFTER_MS, budget }: { after?: number; budget?: number } = {}): () => void {
  const lastDrawn = new globalThis.Map<BaseLayer, number>();
  const own = new WeakMap<BaseLayer, number>();
  const lastShown = new WeakMap<BaseLayer, number>();
  const fitted = new WeakSet<object>();
  let swept = 0;
  const key = map.on("postrender", (event) => {
    const { frameState } = event;
    if (!frameState) return;
    const now = Date.now();
    const onMap = new Set<BaseLayer>();
    for (const state of frameState.layerStatesArray) {
      const { layer } = state;
      if (budget !== undefined && layer instanceof VectorTileLayer) fitTileCache(layer, fitted);
      if (!(layer instanceof WebGLTileLayer)) continue;
      onMap.add(layer);
      if (drawn(state, frameState) || !lastDrawn.has(layer)) lastDrawn.set(layer, now);
    }
    if (now - swept < 2000) return;
    swept = now;
    for (const layer of lastDrawn.keys()) {
      if (onMap.has(layer)) continue;
      lastDrawn.delete(layer);
      (layer as WebGLTileLayer).clearRenderer();
    }
    for (const layer of idleLayers(lastDrawn, now, after)) {
      if (holds(layer as WebGLTileLayer)) (layer as WebGLTileLayer).clearRenderer();
    }
    if (budget === undefined) return;
    const live = [...lastDrawn.keys()].filter((layer) => (layer as WebGLTileLayer).hasRenderer() && now - lastDrawn.get(layer)! <= after);
    for (const layer of live) {
      const cache = ((layer as WebGLTileLayer).getRenderer() as unknown as TileCacheInternals).tileRepresentationCache;
      if (!cache) continue;
      if (!own.has(layer)) own.set(layer, cache.highWaterMark);
      const key = (layer as WebGLTileLayer).getSource()?.getKey();
      // A frame still loading shows few tiles of its own, and the last one's stand in.
      const shown = cache.getValues().filter(({ tile }) => tile.key === key).length;
      cache.highWaterMark = tileShare(budget, live.length, own.get(layer)!, Math.max(shown, lastShown.get(layer) ?? 0));
      lastShown.set(layer, shown);
    }
  });
  return () => unByKey(key);
}
