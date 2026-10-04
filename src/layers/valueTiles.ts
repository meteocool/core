import DataTileSource from "ol/source/DataTile";
import type { Options as DataTileOptions } from "ol/source/DataTile";
import { blankTile, loadValueFrameTile } from "./indexedTiles";
import { ALL_NETWORKS, HOLES, holesSignature } from "./networkHoles";
import type { NetworkCode } from "./networkHoles";
import { maskTile, overlaps, tileExtent } from "./tileMask";
import type { MaskPath } from "./tileMask";
import type { TileIndex } from "../lib/tileIndex";

/**
 * Radar frames as value tiles, drawn by the GPU in the reader's palette.
 *
 * A value tile is a greyscale PNG of bytes: RVP6 for reflectivity
 * (lib/rvp6.ts), a class for precipitation types (lib/hgClasses.ts). Decoded
 * without colour management it is an RGBA bitmap with R = G = B = the
 * value, handed to WebGL as it is: the layer's `palette` style reads band 1
 * and colours it, so nothing is read back to the CPU and a palette change
 * is a style change, not a reload.
 *
 * The frame's tile index gates every request (lib/tileIndex.ts), and past a
 * frame's deepest zoom a tile is cut out of its ancestor's. Two cuts make
 * exactly one radar colour any pixel, as WebGL layers cannot be clipped:
 * DWD's tiles have the EUMETNET networks' countries erased on the steps
 * those have frames for (`setHoles`), and each network's are kept to the
 * ground `extents.ts` gives it (`keep`). Erased is transparent, which the
 * style draws as nothing.
 */

/** How many frames' indices a source remembers before starting afresh. */
const REMEMBERED = 400;

/**
 * One tile of a value frame, with `holes` erased wherever they meet it and,
 * given `keep`, nothing left outside it. Nothing is fetched for a tile
 * outside `keep` altogether.
 */
export async function loadValueTile(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  holes: MaskPath[],
  keep: MaskPath | null,
  signal?: AbortSignal,
): Promise<ImageBitmap | HTMLCanvasElement> {
  const extent = tileExtent(z, x, y);
  if (keep && !overlaps(extent, keep.bbox)) return blankTile();
  const image = await loadValueFrameTile(template, index, z, x, y, signal);
  if (image === blankTile()) return image;
  const met = holes.filter((hole) => overlaps(extent, hole.bbox));
  if (!met.length && !keep) return image;
  const cut = maskTile(image, extent, met, keep);
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

  /**
   * Which networks to erase from which frame, by the frame's URL.
   *
   * The EUMETNET networks have history but no forecast. So a network is cut
   * out of an observed step when the grid has its composite for that step
   * (see `RadarCapability`), and on every other step DWD is left whole:
   * scrubbing forward would otherwise leave Switzerland and France without
   * the only forecast there is. The live frame is holed for every network,
   * whatever the grid says: those layers keep their own newest frame.
   */
  private holes: Map<string, NetworkCode[]>;

  private holesSignature: string;

  /** The only ground this source draws on, or anywhere. */
  private readonly keep: MaskPath | null;

  /**
   * `holed`: DWD's reflectivity, built for its newest observation, which is
   * holed for every network until `setHoles` says otherwise. Anything else
   * has no holes cut. `keep`: a network's own ground.
   */
  constructor(options: Omit<DataTileOptions, "loader" | "bandCount"> & {
    url: string; index?: TileIndex | null; holed?: boolean; keep?: MaskPath | null;
  }) {
    const { url, index, holed, keep, ...rest } = options;
    // RGBA, though only one band means anything: a decoded PNG is four.
    super({ ...rest, bandCount: 4 });
    this.keep = keep ?? null;
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

  /**
   * Which frames to cut which networks out of.
   *
   * `showing` is the URL the caller is about to put on screen, when it is not
   * the one there now. Re-deciding for the frame being left -- which is what
   * happened on every new observation while following live -- gave that frame
   * a fresh key for the instant before the newest replaced it, and a
   * viewport of its tiles was requested to be thrown away.
   */
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
    const keep = this.keep;
    this.setLoader((z, x, y, options) => loadValueTile(url, gate, z, x, y, holes, keep, options.signal));
    // What the renderer caches tiles by: a frame whose holes changed (the live
    // frame becoming history, a network's composite arriving for a step) has
    // to load afresh, so the holes are part of it.
    this.setKey(codes.length ? `${url}#holes:${codes.join(",")}` : url);
  }
}
