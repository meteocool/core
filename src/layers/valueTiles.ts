import DataTileSource from "ol/source/DataTile";
import type { Options as DataTileOptions } from "ol/source/DataTile";
import { blankTile, loadValueFrameTile } from "./indexedTiles";
import { ALL_NETWORKS, HOLES, holesSignature } from "./networkHoles";
import type { NetworkCode } from "./networkHoles";
import { maskTile, overlaps, tileExtent } from "./tileMask";
import type { MaskPath } from "./tileMask";
import type { TileIndex } from "../lib/tileIndex";

/**
 * DWD's frames as value tiles, drawn by the GPU in the reader's palette.
 *
 * A value tile is a greyscale PNG of RVP6 bytes (lib/rvp6.ts). Decoded
 * without colour management it is an RGBA bitmap with R = G = B = the
 * value, handed to WebGL as it is: the layer's `palette` style reads band 1
 * and colours it, so nothing is read back to the CPU and a palette change
 * is a style change, not a reload.
 *
 * Otherwise this is `NetworkHoleTileSource` for those tiles: the same frame
 * index gate, the same magnification past a frame's deepest zoom, and the
 * EUMETNET networks' countries erased on the steps they have frames for.
 * Erased is transparent, value 0 to the palette, which draws nothing.
 */

/** How many frames' indices a source remembers before starting afresh. */
const REMEMBERED = 400;

/** One tile of a value frame, with `holes` erased wherever they meet it. */
export async function loadValueTile(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  holes: MaskPath[],
  signal?: AbortSignal,
): Promise<ImageBitmap | HTMLCanvasElement> {
  const image = await loadValueFrameTile(template, index, z, x, y, signal);
  if (image === blankTile()) return image;
  const extent = tileExtent(z, x, y);
  const met = holes.filter((hole) => overlaps(extent, hole.bbox));
  if (!met.length) return image;
  const cut = maskTile(image, extent, met);
  if (image instanceof ImageBitmap) image.close();
  return cut;
}

/**
 * A `DataTile` source re-pointed at one value frame after another.
 *
 * `DataTile` has no URL: the frame is the template the loader reads, and the
 * key is what the WebGL renderer caches tiles by, so `setUrl` installs both.
 * A new frame, or new holes in one, is a new key, and its tiles load afresh.
 */
export default class ValueTileSource extends DataTileSource {
  private readonly indices = new Map<string, TileIndex | null>();

  private url: string;

  /** Which networks to erase from which frame, by the frame's URL; see `NetworkHoleTileSource`. */
  private holes: Map<string, NetworkCode[]>;

  private holesSignature: string;

  /**
   * `holed`: DWD's reflectivity, built for its newest observation, which is
   * holed for every network until `setHoles` says otherwise. Anything else
   * has no holes cut.
   */
  constructor(options: Omit<DataTileOptions, "loader" | "bandCount"> & {
    url: string; index?: TileIndex | null; holed?: boolean;
  }) {
    const { url, index, holed, ...rest } = options;
    // RGBA, though only one band means anything: a decoded PNG is four.
    super({ ...rest, bandCount: 4 });
    this.holes = new Map(holed ? [[url, ALL_NETWORKS]] : []);
    this.holesSignature = holesSignature(this.holes);
    this.url = url;
    this.setUrl(url, index);
  }

  /** Keep a frame's index for when its URL comes round. */
  remember(url: string, index: TileIndex | null | undefined): void {
    if (index === undefined) return;
    if (this.indices.size > REMEMBERED) this.indices.clear();
    this.indices.set(url, index);
  }

  /** The index remembered for a URL, or nothing known about it. */
  indexFor(url: string): TileIndex | null | undefined {
    return this.indices.get(url);
  }

  /** Which frames have which tiles, by URL; see lib/tileIndex.ts. */
  setIndices(indices: Map<string, TileIndex | null | undefined>): void {
    for (const [url, index] of indices) this.remember(url, index);
  }

  /** Which frames to cut which networks out of; `showing` as `NetworkHoleTileSource.setHoles`. */
  setHoles(holes: Map<string, NetworkCode[]>, showing: string = this.url): void {
    const next = holesSignature(holes);
    if (next === this.holesSignature && showing === this.url) return;
    this.holes = holes;
    this.holesSignature = next;
    if (showing) this.setUrl(showing);
  }

  setUrl(url: string, index?: TileIndex | null): void {
    this.remember(url, index);
    this.url = url;
    const gate = this.indexFor(url);
    const codes = this.holes.get(url) ?? [];
    const holes = HOLES.filter((hole) => codes.includes(hole.code));
    this.setLoader((z, x, y, options) => loadValueTile(url, gate, z, x, y, holes, options.signal));
    this.setKey(codes.length ? `${url}#holes:${codes.join(",")}` : url);
  }
}
