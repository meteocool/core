import DataTileSource from "ol/source/DataTile";
import type { Options as DataTileOptions } from "ol/source/DataTile";
import type { Extent as MapExtent } from "ol/extent";
import { blankTile, fetchFrameTile, present } from "./indexedTiles";
import { ALL_NETWORKS, HOLES, holesSignature } from "./networkHoles";
import type { NetworkCode } from "./networkHoles";
import { overlaps, tileExtent } from "./tileMask";
import { packValueTile } from "./packTiles";
import { drawsNothing } from "../lib/packPixels";
import type { MaskPath } from "./tileMask";
import { sourceTile } from "../lib/tileIndex";
import type { TileIndex } from "../lib/tileIndex";
import { BLANK, DecodedTiles, tileKey } from "../lib/decodedTiles";
import { decodedTileBytes } from "../lib/gpuBudget";
import { getCacheKey } from "ol/renderer/webgl/TileLayerBase";
import type WebGLTileLayer from "ol/layer/WebGLTile";

/**
 * Radar frames as value tiles, drawn by the GPU in the reader's palette.
 *
 * A value tile is a greyscale PNG of bytes: RVP6 for reflectivity
 * (lib/rvp6.ts), a class for precipitation types (lib/hgClasses.ts), a
 * height or a weight for an echo top or VIL (lib/columnValues.ts). A
 * worker decodes it to those bytes (lib/valuePng.ts) and packs them
 * (packTiles.ts) before WebGL gets them: the layer's `palette` style reads
 * band 1 and colours it on the GPU, so a palette change is a style change,
 * not a reload.
 *
 * Every request is checked against the frame's tile index (lib/tileIndex.ts),
 * and past a frame's deepest zoom a tile is cut out of its ancestor's. Two cuts make
 * exactly one radar colour any pixel, as WebGL layers cannot be clipped:
 * DWD's tiles have the EUMETNET networks' countries erased on the steps
 * those have frames for (`setHoles`), and each network's are kept to the
 * ground `extents.ts` gives it (`keep`). Erased is transparent, which the
 * style draws as nothing.
 *
 * Every tile a source loads, and every tile decoded ahead of playback, is
 * kept in `decodedTiles` by what decides its bytes, and a source asked for
 * one it holds answers at once (`loadStoredTile`).
 */

/** How many frames' indices a source remembers before starting afresh. */
const REMEMBERED = 400;

/**
 * One tile of a value frame, with `holes` erased wherever they meet it and,
 * given `keep`, nothing left outside it. Nothing is fetched for a tile
 * outside `keep` altogether.
 *
 * Decoded and packed to the bytes that mean something (packTiles.ts), or a
 * blank where there is nothing, the cut having left nothing included.
 * `size` is the source's tile size.
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
): Promise<Uint8Array | HTMLCanvasElement> {
  const extent = tileExtent(z, x, y);
  if (keep && !overlaps(extent, keep.bbox)) return blankTile();
  const fetched = await fetchFrameTile(template, index, z, x, y, signal);
  if (!fetched) return blankTile();
  const met = holes.filter((hole) => overlaps(extent, hole.bbox));
  const packed = await packValueTile(fetched.png, fetched.from, extent, met, keep, size, signal);
  // Nothing left to draw, once cut: a blank, with no texture behind it.
  return drawsNothing(packed, size * size) ? blankTile() : packed;
}

/**
 * The value tiles of every layer, decoded: those a source loaded, and those
 * decoded ahead of playback (lib/framePreload.ts); see lib/decodedTiles.ts.
 */
export const decodedTiles = new DecodedTiles(decodedTileBytes());

/** One tile, as a source's loader is handed it; what playback decodes ahead. */
export interface TileJob {
  /** What `decodedTiles` keeps it under. */
  key: string;
  template: string;
  index: TileIndex | null | undefined;
  z: number;
  x: number;
  y: number;
  /** Only the holes that meet the tile: others cut nothing from it. */
  holes: MaskPath[];
  keep: MaskPath | null;
  size: number;
  /**
   * A blank answered without asking anyone: outside `keep` altogether, or a
   * tile the frame's index says it does not have. Never worth decoding ahead.
   */
  local: boolean;
  /** The source that will ask for it, and the key it will ask under: where to look for it on the GPU. */
  drawnBy?: { source: ValueTileSource; sourceKey: string };
}

const pathNames = new WeakMap<MaskPath, string>();
let paths = 0;

/** A mask path's name in a tile's key: the same path, the same name, for as long as it exists. */
function pathName(path: MaskPath): string {
  let name = pathNames.get(path);
  if (name === undefined) {
    paths += 1;
    name = `p${paths}`;
    pathNames.set(path, name);
  }
  return name;
}

/** Tile `z`/`x`/`y` of the frame at `template`, holed by `holes` and kept to `keep`, as a job. */
export function valueTileJob(
  template: string,
  index: TileIndex | null | undefined,
  z: number,
  x: number,
  y: number,
  holes: MaskPath[],
  keep: MaskPath | null,
  size = 512,
): TileJob {
  const extent = tileExtent(z, x, y);
  const met = holes.filter((hole) => overlaps(extent, hole.bbox));
  const from = sourceTile(index, z, x, y);
  const local = (keep !== null && !overlaps(extent, keep.bbox)) || (Boolean(index) && !present(index, from.z, from.x, from.y));
  const key = tileKey({ template, z, x, y, holes: met.map(pathName), keep: keep ? pathName(keep) : null, size });
  return { key, template, index, z, x, y, holes: met, keep, size, local };
}

/**
 * Whether the layer drawing a job's source already holds its tile, uploaded
 * and ready to draw. Its texture cache is keyed by the frame, so on a
 * desktop a whole loop of a viewport stays on the GPU after the first time
 * round, and those tiles need nothing decoded: they are drawn as soon as
 * the frame is shown, whatever the decoded tiles have let go.
 */
export function heldOnScreen(job: TileJob): boolean {
  if (!job.drawnBy) return false;
  const { source, sourceKey } = job.drawnBy;
  const layer = layerOf.get(source);
  if (!layer?.hasRenderer()) return false;
  const cache = (layer.getRenderer() as unknown as FrameCache).tileRepresentationCache;
  const at = getCacheKey(source, [job.z, job.x, job.y], sourceKey);
  return Boolean(cache?.containsKey(at) && cache.peek(at).ready);
}

/** Whether a job's tile is ready to draw at once: answered on the spot, decoded, or on the GPU. */
export function tileReady(job: TileJob): boolean {
  return job.local || decodedTiles.has(job.key) || heldOnScreen(job);
}

/** Tiles being loaded, by key: a tile the preloader and a source both want is loaded once. */
const loading = new Map<string, Promise<Uint8Array | HTMLCanvasElement>>();

/**
 * A job's tile: from `decodedTiles` at once where it is kept, else loaded
 * (`loadValueTile`) and kept. The bytes kept are the very array returned, so
 * a tile OpenLayers holds costs nothing more here.
 */
export function loadStoredTile(job: TileJob, signal?: AbortSignal): Promise<Uint8Array | HTMLCanvasElement> {
  if (job.local) return Promise.resolve(blankTile());
  const kept = decodedTiles.get(job.key);
  if (kept !== undefined) return Promise.resolve(kept === BLANK ? blankTile() : kept);
  const running = loading.get(job.key);
  if (running) return running;
  const epoch = decodedTiles.epoch;
  const load = loadValueTile(job.template, job.index, job.z, job.x, job.y, job.holes, job.keep, signal, job.size)
    .then((tile) => {
      decodedTiles.put(job.key, tile instanceof Uint8Array ? tile : BLANK, epoch);
      return tile;
    })
    .finally(() => loading.delete(job.key));
  loading.set(job.key, load);
  return load;
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
 * What the renderer caches a frame's tiles by: a frame whose holes changed
 * (the live frame becoming history, a network's composite arriving for a
 * step) has to load afresh, so the holes are part of it.
 */
function frameKey(url: string, codes: readonly NetworkCode[]): string {
  return codes.length ? `${url}#holes:${codes.join(",")}` : url;
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
   * the one there now. Re-deciding for the frame being left (which happened
   * on every new observation while following live) gave that frame a fresh
   * key for the instant before the newest replaced it, and a viewport of its
   * tiles was requested only to be thrown away.
   */
  setHoles(holes: Map<string, NetworkCode[]>, showing: string = this.url): void {
    const next = holesSignature(holes);
    if (next === this.holesSignature && showing === this.url) return;
    this.holes = holes;
    this.holesSignature = next;
    if (showing) this.setUrl(showing);
  }

  /** What the loader is handed for a frame's tiles, by the frame's name: as things stand now. */
  private frameArgs(url: string): { template: string; gate: TileIndex | null | undefined; holes: MaskPath[]; codes: NetworkCode[] } {
    const codes = this.holes.get(url) ?? [];
    return {
      template: templateOf(url),
      gate: this.indexFor(url),
      holes: HOLES.filter((hole) => codes.includes(hole.code)),
      codes,
    };
  }

  /** The side of this source's tiles at zoom `z`, in pixels. */
  private sizeAt(z: number): number {
    const size = this.getTileGrid()!.getTileSize(z);
    return typeof size === "number" ? size : size[0];
  }

  /**
   * The tiles OpenLayers will ask this source for of frame `url`, over
   * `extent` at the view's `resolution`, exactly as its loader would be
   * handed them once the frame is shown with the holes it has now; at most
   * `max`. What playback decodes ahead, and waits for.
   */
  tileJobs(url: string, index: TileIndex | null | undefined, extent: MapExtent, resolution: number, max: number): TileJob[] {
    this.remember(url, index);
    const { template, gate, holes, codes } = this.frameArgs(url);
    const drawnBy = { source: this, sourceKey: frameKey(url, codes) };
    const grid = this.getTileGrid()!;
    // The zoom the renderer draws at, as it works it out.
    const z = grid.getZForResolution(resolution, this.zDirection);
    const jobs: TileJob[] = [];
    grid.forEachTileCoord(extent, z, ([tz, x, y]) => {
      if (jobs.length < max) jobs.push({ ...valueTileJob(template, gate, tz, x, y, holes, this.keep, this.sizeAt(tz)), drawnBy });
    });
    return jobs;
  }

  setUrl(url: string, index?: TileIndex | null): void {
    this.remember(url, index);
    this.url = url;
    const { template, gate, holes, codes } = this.frameArgs(url);
    const keep = this.keep;
    this.setLoader((z, x, y, options) => loadStoredTile(
      valueTileJob(template, gate, z, x, y, holes, keep, this.sizeAt(z)),
      options.signal,
    ));
    this.setKey(frameKey(url, codes));
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
 * twice. That is hundreds of tiles a layer, for DWD and every network, and
 * with the tiles decoded ahead of it (`decodedTiles`), most of the radar's
 * memory. Once the player is closed nothing steps through them any
 * more. Each layer lets them go the next time its own frame is fully drawn,
 * which is after the switch back to the newest: dropped at once, they could
 * not stand in while it loads, and the radar would blink empty.
 */
export function forgetEarlierFrames(): void {
  forgetting += 1;
  // Not drawn from, so nothing blinks: they go now.
  decodedTiles.clear();
}

/**
 * Every value layer, for `dropEarlierFrames`.
 */
const valueLayers = new Set<WebGLTileLayer>();

/**
 * Drop the tiles of every frame but the one each value layer shows, now.
 *
 * `forgetEarlierFrames` waits for each layer's next fully drawn frame, and a
 * flat map that is not on screen draws none: with the 3D map up, a playback's
 * frames stayed held the whole time, beside everything the 3D map holds. On
 * an iPhone the two together passed the web view's 2 GB, and iOS killed it
 * (October 2026). For a map nobody sees, a blink on the way back is no cost.
 */
export function dropEarlierFrames(): void {
  forgetting += 1;
  decodedTiles.clear();
  for (const layer of valueLayers) {
    // A layer replaced and disposed (precipitation types) is let go here.
    if ((layer as unknown as { disposed: boolean }).disposed) valueLayers.delete(layer);
    else dropFramesBut(layer);
  }
}

/** Dispose of every tile a layer holds that is not of the frame it shows. */
function dropFramesBut(layer: WebGLTileLayer): void {
  const renderer = layer.getRenderer() as unknown as FrameCache | null;
  const cache = renderer?.tileRepresentationCache;
  const shown = layer.getSource()?.getKey();
  if (!cache || shown === undefined) return;
  for (const key of cache.getKeys()) {
    const tile = cache.peek(key);
    if (tile.tile.key === shown) continue;
    cache.remove(key);
    tile.dispose();
  }
}

interface FrameCache {
  renderComplete?: boolean;
  getStaleKeys?(): string[];
  tileRepresentationCache?: {
    getKeys(): string[];
    containsKey(key: string): boolean;
    peek(key: string): { tile: { key: string }; ready: boolean; dispose(): void };
    remove(key: string): unknown;
  };
}

/** Each value layer, by its source: whose renderer holds the source's tiles. */
const layerOf = new WeakMap<object, WebGLTileLayer>();

/**
 * Let an older frame stand in only while the frame on screen loads.
 *
 * When a source changes key (a new frame, a step of playback), OpenLayers
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
  valueLayers.add(layer);
  const source = layer.getSource();
  if (source) layerOf.set(source, layer);
  layer.on("postrender", () => {
    const renderer = layer.getRenderer() as unknown as FrameCache | null;
    if (!renderer?.renderComplete) return;
    const stale = renderer.getStaleKeys?.();
    if (stale?.length) stale.length = 0;
    if (forgot === forgetting) return;
    forgot = forgetting;
    dropFramesBut(layer);
  });
  return layer;
}
