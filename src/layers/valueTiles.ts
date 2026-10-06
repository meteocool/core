import DataTileSource from "ol/source/DataTile";
import type { Options as DataTileOptions } from "ol/source/DataTile";
import { blankTile, fetchFrameTile } from "./indexedTiles";
import { ALL_NETWORKS, HOLES, holesSignature } from "./networkHoles";
import type { NetworkCode } from "./networkHoles";
import { overlaps, tileExtent } from "./tileMask";
import { packValueTile } from "./packTiles";
import type { MaskPath } from "./tileMask";
import type { TileIndex } from "../lib/tileIndex";
import type WebGLTileLayer from "ol/layer/WebGLTile";

/**
 * Radar frames as value tiles, drawn by the GPU in the reader's palette.
 *
 * A value tile is a greyscale PNG of bytes: RVP6 for reflectivity
 * (lib/rvp6.ts), a class for precipitation types (lib/hgClasses.ts). Decoded
 * without colour management it is an RGBA bitmap with R = G = B = the
 * value, which a worker packs down to the value alone (packTiles.ts) before
 * WebGL gets it: the layer's `palette` style reads band 1 and colours it on
 * the GPU, so a palette change is a style change, not a reload.
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
 *
 * Packed to the bytes that mean something (packTiles.ts), unless no worker
 * can do it, when it is the decoded image or a canvas cut from it. `size` is
 * the source's tile size.
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
  size = 512,
): Promise<Uint8Array | ImageBitmap | HTMLCanvasElement> {
  const extent = tileExtent(z, x, y);
  if (keep && !overlaps(extent, keep.bbox)) return blankTile();
  const fetched = await fetchFrameTile(template, index, z, x, y, signal);
  if (!fetched) return blankTile();
  const met = holes.filter((hole) => overlaps(extent, hole.bbox));
  return packValueTile(fetched.bitmap, fetched.from, extent, met, keep, size, signal);
}

/**
 * A frame's name on a step it is drawn on: its tiles' template, or, where it
 * stands on a step other than the one it was measured for, the template and
 * that step.
 *
 * The source keys a frame's holes by its name, and one frame can be drawn on
 * two steps cut two ways: DMAX's newest stands on the live step, holed for
 * every network, a cycle after its own, holed only for the networks that have
 * a composite there. Under one name, the one step's cut was the other's too.
 */
export function frameOnStep(template: string, measuredAt: number | null | undefined, step: number): string {
  return measuredAt === null || measuredAt === undefined || measuredAt === step ? template : `${template}#${step}`;
}

/** The tile template a frame's name points at: `frameOnStep`'s suffix is not fetched. */
export function templateOf(name: string): string {
  const at = name.indexOf("#");
  return at < 0 ? name : name.slice(0, at);
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
    // Band 4 is the coverage the style fades by: a packed tile has it as its
    // second byte or, opaque throughout, not at all, which the GPU reads as
    // opaque; an unpacked one is RGBA.
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
    const template = templateOf(url);
    this.setLoader((z, x, y, options) => {
      const size = this.getTileGrid()!.getTileSize(z);
      return loadValueTile(template, gate, z, x, y, holes, keep, options.signal, typeof size === "number" ? size : size[0]);
    });
    // What the renderer caches tiles by: a frame whose holes changed (the live
    // frame becoming history, a network's composite arriving for a step) has
    // to load afresh, so the holes are part of it.
    this.setKey(codes.length ? `${url}#holes:${codes.join(",")}` : url);
  }
}

/**
 * Asked for by `forgetEarlierFrames`; each layer compares its own count to it.
 */
let forgetting = 0;

/**
 * Let every value layer drop the tiles of every frame but the one it shows.
 *
 * Playback keeps each step's tiles, so a loop never fetches or decodes them
 * twice -- up to 512 tiles a layer, for DWD and every network, most of the
 * radar's memory. Once the player is closed nothing steps through them any
 * more. Each layer lets them go the next time its own frame is fully drawn,
 * which is after the switch back to the newest: dropped at once, they could
 * not stand in while it loads, and the radar would blink empty.
 */
export function forgetEarlierFrames(): void {
  forgetting += 1;
}

interface FrameCache {
  renderComplete?: boolean;
  getStaleKeys?(): string[];
  tileRepresentationCache?: {
    getKeys(): string[];
    peek(key: string): { tile: { key: string }; dispose(): void };
    remove(key: string): unknown;
  };
}

/**
 * Let an older frame stand in only while the frame on screen loads.
 *
 * When a source changes key -- a new frame, a step of playback -- OpenLayers
 * draws a tile it has not loaded yet from the same tile of an earlier key, so
 * the radar never flashes empty between frames. It keeps that up for half the
 * layer's cache in keys, which for these layers is hundreds of frames, and it
 * prefers such a tile to a coarser one of the frame actually showing. So a
 * tile cached at zoom 8 an hour ago was still a stand-in an hour later: zoom
 * out, let a frame or two arrive, zoom back in, and the map showed the radar
 * from before you zoomed out, then jumped to now. Panning back over ground
 * seen earlier did the same.
 *
 * Once the frame on screen is fully drawn, the earlier keys are dropped: the
 * swap they bridge is over. A later zoom or pan then fills in from coarser
 * tiles of the current frame, which is blurrier for a moment but never the
 * wrong time. That is also when the earlier frames' tiles themselves go,
 * if `forgetEarlierFrames` has asked since the last time.
 */
export function staleOnlyWhileLoading<L extends WebGLTileLayer>(layer: L): L {
  let forgot = forgetting;
  layer.on("postrender", () => {
    const renderer = layer.getRenderer() as unknown as FrameCache | null;
    if (!renderer?.renderComplete) return;
    const stale = renderer.getStaleKeys?.();
    if (stale?.length) stale.length = 0;
    if (forgot === forgetting) return;
    forgot = forgetting;
    const cache = renderer.tileRepresentationCache;
    const shown = layer.getSource()?.getKey();
    if (!cache || shown === undefined) return;
    for (const key of cache.getKeys()) {
      const tile = cache.peek(key);
      if (tile.tile.key === shown) continue;
      cache.remove(key);
      tile.dispose();
    }
  });
  return layer;
}
