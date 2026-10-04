import { hasTile, sourceTile } from "../lib/tileIndex";
import type { SourceTile, TileIndex } from "../lib/tileIndex";
import { RequestStalled, timedFetch } from "../lib/timedFetch";

/**
 * Loading a frame's tiles: consulting its tile index before asking the network.
 *
 * The renderer writes no tile that would draw nothing, so a frame is missing
 * most of its grid on a dry day and every one of those tiles was a request
 * answered 404 -- per frame, per loop, never cached. Each frame now says
 * which tiles it has (lib/tileIndex.ts), and a tile it lacks is answered
 * here with a blank that OpenLayers draws as nothing.
 *
 * A frame from before the index existed has none, and loads as it always did.
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
 * that never answer were a map that never loaded another one.
 */
export const TILE_TIMEOUT_MS = 30_000;

/** How a value tile is decoded: its bytes as they are, no colour management, no premultiplying. */
export const VALUE_DECODE: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

/**
 * A value tile (lib/rvp6.ts), fetched and decoded as its bytes; null where
 * the frame has no such tile (404).
 *
 * Not an `<img>`, which may colour-manage a greyscale PNG on its way to the
 * screen -- Safari does -- and a value one off is another class. Under the
 * same ceiling as `loadImage`, and `timedFetch`'s stall besides.
 */
export async function fetchValueTile(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
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
    return await createImageBitmap(await response.blob(), VALUE_DECODE);
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
 * One part of a tile, drawn at the tile's full size pixel for pixel.
 *
 * Nearest-neighbour, as every radar layer here draws: a 1 km pixel magnified
 * stays a square of its own colour rather than a blur into its neighbours.
 */
export function magnify(
  image: ImageBitmap,
  { scale, column, row }: Pick<SourceTile, "scale" | "column" | "row">,
): ImageBitmap | HTMLCanvasElement {
  if (scale === 1) return image;
  const size = image.width;
  const part = size / scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return image;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, column * part, row * part, part, part, 0, 0, size, size);
  return canvas;
}

/**
 * What a frame has for tile `z`/`x`/`y`: the tile's bytes, the part of its
 * ancestor past the frame's deepest zoom (`sourceTile`), or a blank where it
 * has nothing.
 */
export async function loadValueFrameTile(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ImageBitmap | HTMLCanvasElement> {
  const from = sourceTile(index, z, x, y);
  if (index && !present(index, from.z, from.x, from.y)) return blankTile();
  const bitmap = await fetchValueTile(fillTemplate(template, from.z, from.x, from.y), signal);
  if (!bitmap) return blankTile();
  const image = magnify(bitmap, from);
  if (image !== bitmap) bitmap.close();
  return image;
}
