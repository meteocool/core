import { hasTile, sourceTile } from "../lib/tileIndex";
import type { SourceTile, TileIndex } from "../lib/tileIndex";
import { RequestStalled, timedFetch } from "../lib/timedFetch";

/**
 * Loading a frame's tiles: consulting its tile index before asking the network.
 *
 * The renderer writes no tile that would draw nothing, so on a dry day a frame
 * is missing most of its grid. Without an index each of those tiles is a
 * request answered 404, per frame and per loop, never cached. Each frame says
 * which tiles it has (lib/tileIndex.ts), and a tile it lacks is answered here
 * with a blank that OpenLayers draws as nothing.
 *
 * A frame from before the index existed has none and requests every tile.
 * The sources are `valueTiles.ts`; the 3D map's are `maskedTiles.ts`.
 */

/** The URL template, with the tile filled in. `{-y}` is TMS, as the tiles are published. */
export function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{-y}", String(2 ** z - 1 - y))
    .replace("{y}", String(y));
}

/**
 * How long one tile may take, whole, before it counts as failed.
 *
 * A ceiling on top of timedFetch's stall: generous enough for a tile on a slow link, short
 * enough that a tile sent into a dead connection gives back its place in
 * OpenLayers' queue. That queue loads sixteen at a time, and sixteen tiles
 * that never answer would keep the map from loading any other.
 */
export const TILE_TIMEOUT_MS = 30_000;

/**
 * A value tile (lib/rvp6.ts), fetched as its PNG; null where the frame has
 * no such tile (404).
 *
 * Fetched rather than loaded as an `<img>`, and left to lib/valuePng.ts to
 * decode: a browser's decoder may colour-manage a greyscale PNG (WebKit
 * does, whatever it is asked), and a value one off is another class. Under
 * the same ceiling as `loadImage`, plus `timedFetch`'s stall.
 */
export async function fetchValueTile(url: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const controller = new AbortController();
  let late = false;
  const timer = setTimeout(() => { late = true; controller.abort(); }, TILE_TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await timedFetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return await response.arrayBuffer();
  } catch (error) {
    throw late ? new RequestStalled(url, TILE_TIMEOUT_MS) : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

let blank: HTMLCanvasElement | null = null;

/** One transparent pixel, shared: stretched over a tile it draws nothing. */
export function blankTile(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement("canvas");
    blank.width = 1;
    blank.height = 1;
  }
  return blank;
}

/** Whether the frame behind `template` has the tile OpenLayers is asking for. */
export function present(index: TileIndex | null | undefined, z: number, x: number, y: number): boolean {
  return hasTile(index, z, x, 2 ** z - 1 - y);
}

/**
 * What a frame has for tile `z`/`x`/`y`: the PNG it comes out of (its own,
 * or its ancestor's past the frame's deepest zoom) and which part of that it
 * is (`sourceTile`), or null where the frame has nothing.
 */
export async function fetchFrameTile(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<{ png: ArrayBuffer; from: SourceTile } | null> {
  const from = sourceTile(index, z, x, y);
  if (index && !present(index, from.z, from.x, from.y)) return null;
  const png = await fetchValueTile(fillTemplate(template, from.z, from.x, from.y), signal);
  return png ? { png, from } : null;
}
