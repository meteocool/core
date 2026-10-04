import ImageTileSource from "ol/source/ImageTile";
import { hasTile, sourceTile } from "../lib/tileIndex";
import { paintValueImage, recolourImage, recolouringFor } from "./recolour";
import type { SourceTile, TileIndex } from "../lib/tileIndex";
import { RequestStalled, timedFetch } from "../lib/timedFetch";
import { RVP6_ENCODING } from "../lib/rvp6";

/**
 * Tile sources that consult a frame's tile index before asking the network.
 *
 * The renderer writes no tile that would be fully transparent, so a frame is
 * missing most of its grid on a dry day and every one of those tiles was a
 * request answered 404 -- per frame, per loop, never cached. Each frame now
 * says which tiles it has (lib/tileIndex.ts), and a tile it lacks is answered
 * here with a blank that OpenLayers draws as nothing.
 *
 * A frame from before the index existed has none, and loads as it always did.
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
 * An image says nothing until it is done, so this is a ceiling rather than
 * timedFetch's stall: generous enough for a tile on a slow link, short
 * enough that a tile sent into a dead connection gives back its place in
 * OpenLayers' queue. That queue loads sixteen at a time, and sixteen tiles
 * that never answer were a map that never loaded another one.
 */
export const TILE_TIMEOUT_MS = 30_000;

export function loadImage(
  url: string,
  crossOrigin: string | null,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  const image = new Image();
  if (crossOrigin !== null) image.crossOrigin = crossOrigin;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal?.removeEventListener("abort", cancel);
    };
    // Emptying `src` is what calls the request off.
    const give = (reason: unknown) => {
      settle();
      image.src = "";
      reject(reason);
    };
    const cancel = () => give(signal?.reason);
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => give(new RequestStalled(url, TILE_TIMEOUT_MS)), TILE_TIMEOUT_MS);
    image.src = url;
    image.decode().then(
      () => { settle(); resolve(image); },
      (error) => { settle(); reject(error); },
    );
  });
}

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
export function magnify<T extends HTMLImageElement | ImageBitmap>(
  image: T,
  { scale, column, row }: Pick<SourceTile, "scale" | "column" | "row">,
): T | HTMLCanvasElement {
  if (scale === 1) return image;
  // An <img> or, for the 3D map's tiles (maskedTiles.ts), a decoded bitmap.
  const size = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
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
 * What a frame has for tile `z`/`x`/`y`: the tile, the part of its ancestor
 * past the frame's deepest zoom (`sourceTile`), or a blank where it has nothing.
 */
export async function loadFrameTile(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  crossOrigin: string | null,
  signal?: AbortSignal,
): Promise<HTMLImageElement | HTMLCanvasElement> {
  const from = sourceTile(index, z, x, y);
  if (index && !present(index, from.z, from.x, from.y)) return blankTile();
  return magnify(await loadImage(fillTemplate(template, from.z, from.x, from.y), crossOrigin, signal), from);
}

/** `loadFrameTile` for a frame of value tiles: their bytes, or a blank where it has nothing. */
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

/** How many frames' indices a source remembers before starting afresh. */
const REMEMBERED = 400;

/**
 * An `ImageTileSource` that skips the tiles a frame does not have.
 *
 * `setUrl` takes the frame's index alongside its URL and remembers it, so a
 * later `setUrl` back to the same frame -- playback walks one source across
 * every step -- finds it again.
 *
 * And it draws the tiles in a palette, when given one other than the classic
 * the renderer paints them in: see recolour.ts. DWD's layer does that on the
 * GPU instead, and never sets one here. A frame of value tiles, which
 * `setUrl` is told by its encoding, is painted in every palette, classic too.
 */
export default class IndexedTileSource extends ImageTileSource {
  protected readonly crossOriginValue: string | null;

  protected readonly indices = new Map<string, TileIndex | null>();

  /** What each frame's tiles hold, by URL, where that is values and not colours. */
  protected readonly encodings = new Map<string, string>();

  /* `declare`, not initialised: the constructor's `setUrl` runs before a
     subclass's initialisers would, and reads this. Unset means classic. */
  declare private palette: string | undefined;

  /** The URL the source is on; see `setPalette`. */
  declare private shownUrl: string | undefined;

  constructor(options: ConstructorParameters<typeof ImageTileSource>[0] & {
    url: string; index?: TileIndex | null; palette?: string; encoding?: string;
  }) {
    const { url, index, palette, encoding, ...rest } = options;
    super(rest);
    this.crossOriginValue = options.crossOrigin ?? null;
    this.palette = palette;
    this.setUrl(url, index, encoding);
  }

  /** Draw the tiles in this palette from now on, reloading the ones held. */
  setPalette(palette: string): void {
    if (palette === (this.palette ?? "classic")) return;
    this.palette = palette;
    if (this.shownUrl) this.setUrl(this.shownUrl);
  }

  /** Keep a frame's index, and its tiles' encoding, for when its URL comes round. */
  remember(url: string, index: TileIndex | null | undefined, encoding?: string): void {
    if (encoding) {
      if (this.encodings.size > REMEMBERED) this.encodings.clear();
      this.encodings.set(url, encoding);
    }
    if (index === undefined) return;
    if (this.indices.size > REMEMBERED) this.indices.clear();
    this.indices.set(url, index);
  }

  /** The index remembered for a URL, or nothing known about it. */
  indexFor(url: string): TileIndex | null | undefined {
    return this.indices.get(url);
  }

  setUrl(url: string, index?: TileIndex | null, encoding?: string): void {
    this.remember(url, index, encoding);
    this.shownUrl = url;
    super.setUrl(url);
    const gate = this.indexFor(url);
    if (this.encodings.get(url) === RVP6_ENCODING) {
      // One `getImageData` per tile, the last left on this path: these are
      // canvas layers, for the clip in network.ts.
      const palette = this.palette ?? "classic";
      this.setLoader(async (z: number, x: number, y: number, options?: { signal?: AbortSignal }) => {
        const image = await loadValueFrameTile(url, gate, z, x, y, options?.signal);
        if (image === blankTile()) return image;
        const painted = paintValueImage(image, palette);
        if (image instanceof ImageBitmap) image.close();
        return painted;
      });
      this.setKey(`${url}#palette:${palette}`);
      return;
    }
    const table = recolouringFor(this.palette ?? "classic");
    const crossOrigin = this.crossOriginValue;
    // Ours even with nothing to gate or recolour, for the ceiling on each tile
    // that OpenLayers' own loader does not have; see TILE_TIMEOUT_MS.
    this.setLoader(async (z: number, x: number, y: number, options?: { signal?: AbortSignal }) => {
      const image = await loadFrameTile(url, gate, z, x, y, crossOrigin, options?.signal);
      return table && image !== blankTile() ? recolourImage(image, table) : image;
    });
    // Cached by key, and the key `super.setUrl` gave is the bare URL: without
    // the palette in it, a change of palette went on serving the old tiles.
    if (table) this.setKey(`${url}#palette:${this.palette}`);
  }
}
