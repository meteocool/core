/**
 * A coarse picture of every frame of the timeline, to draw until the frame's
 * own tiles are in.
 *
 * A hand on the timeline crosses a frame every few tens of milliseconds, and
 * a frame's tiles for the map in view take far longer than that to fetch and
 * decode: the map stood on the frame it had until the needle came to rest,
 * and then for as long again as the tiles took. So for each frame the map's
 * ground is also kept from tiles a few zooms up (`previewZoom`), one or two
 * requests a source rather than a dozen, and of each only the part the map
 * is looking at, with a margin for a pan (`cropFor`): a few tens of
 * kilobytes a frame, so every frame of the timeline fits where one frame's
 * tiles would. The frame layer (layers/radarFrames.ts) moves to a frame as
 * soon as these cover it, blurred, and sharpens it tile by tile.
 *
 * No OpenLayers and no WebGL here: an extent is four numbers, west, south,
 * east and north, and what a piece is keyed by is the caller's to say.
 */
import { BLANK } from "./decodedTiles";
import type { DecodedTile } from "./decodedTiles";

/** West, south, east, north, in map units. */
export type Box = readonly number[];

/** How many zooms coarser than the map's tiles the preview is: an eighth of the resolution. */
export const PREVIEW_ZOOMS = 3;

/**
 * What a crop's edges snap to, in pixels of the preview: 256 of the screen's
 * at an eighth of its resolution. The map can pan this far in each direction
 * before another crop is needed, and two views a little apart ask for the
 * same one. A tile thinned to that resolution (`previewScale`) is cropped in
 * blocks as many times larger, so that the ground a block covers is the same.
 */
export const PREVIEW_BLOCK = 32;

/**
 * The zoom a view drawn from tiles at `z` is previewed from: `PREVIEW_ZOOMS`
 * up, no further than the pyramid's top. Null where that is no coarser than
 * the view's own tiles, which are then as few as a preview's would be.
 */
export function previewZoom(z: number, minZ: number): number | null {
  const zoom = Math.max(minZ, z - PREVIEW_ZOOMS);
  return zoom < z ? zoom : null;
}

/** What a piece costs besides its values. */
const PIECE_OVERHEAD = 256;

/** A rectangle of a tile, in its pixels, from its north-west corner. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a tile of `size` pixels a side, covering `tile`, that `view`
 * needs: every block the view touches and `margin` blocks around them, kept
 * inside the tile. Null where the view misses the tile.
 */
export function cropFor(tile: Box, size: number, view: Box, block = PREVIEW_BLOCK, margin = 1): Crop | null {
  const [west, south, east, north] = tile;
  if (view[0] >= east || view[2] <= west || view[1] >= north || view[3] <= south) return null;
  const perUnit = size / (east - west);
  const blocks = Math.ceil(size / block);
  const first = (pixel: number) => Math.max(0, Math.floor(pixel / block) - margin);
  const last = (pixel: number) => Math.min(blocks, Math.ceil(pixel / block) + margin);
  const x0 = first((view[0] - west) * perUnit);
  const x1 = last((view[2] - west) * perUnit);
  // Rows count down from the tile's northern edge.
  const y0 = first((north - view[3]) * perUnit);
  const y1 = last((north - view[1]) * perUnit);
  const x = x0 * block;
  const y = y0 * block;
  return { x, y, width: Math.min(size, x1 * block) - x, height: Math.min(size, y1 * block) - y };
}

/** The ground a crop of a tile covers. */
export function cropExtent(tile: Box, size: number, crop: Crop): number[] {
  const perPixel = (tile[2] - tile[0]) / size;
  return [
    tile[0] + crop.x * perPixel,
    tile[3] - (crop.y + crop.height) * perPixel,
    tile[0] + (crop.x + crop.width) * perPixel,
    tile[3] - crop.y * perPixel,
  ];
}

/**
 * How many pixels of a tile at `zoom` go into one of the preview, a side,
 * for a view drawn from tiles at `z`: 1 where the tile is the full
 * `PREVIEW_ZOOMS` up. Near the pyramid's top it is not, and its pixels are
 * finer than a preview needs, four or sixteen times the bytes: they are
 * thinned to the same eighth of the view's resolution.
 */
export function previewScale(z: number, zoom: number): number {
  return 2 ** Math.max(0, PREVIEW_ZOOMS - (z - zoom));
}

/** A crop's name in a key, thinned by `scale`. */
export function cropName({ x, y, width, height }: Crop, scale = 1): string {
  return `${x},${y},${width}x${height}/${scale}`;
}

/**
 * The crop's pixels out of a decoded tile of `size` a side: as many bytes a
 * pixel as the tile has, a row after another from the north. Thinned by
 * `scale`, each pixel is the strongest value of the `scale` by `scale` it
 * stands for, so that a narrow core is not lost, with the coverage beside
 * that value where the tile has one. The crop's sides are multiples of
 * `scale`, as `cropFor`'s are of its block.
 */
export function cropBytes(tile: Uint8Array, size: number, crop: Crop, scale = 1): Uint8Array {
  const bands = tile.byteLength / (size * size);
  if (scale === 1 && crop.x === 0 && crop.y === 0 && crop.width === size && crop.height === size) return tile;
  const width = crop.width / scale;
  const height = crop.height / scale;
  const out = new Uint8Array(width * height * bands);
  if (scale === 1) {
    const row = width * bands;
    for (let y = 0; y < height; y += 1) {
      const from = ((crop.y + y) * size + crop.x) * bands;
      out.set(tile.subarray(from, from + row), y * row);
    }
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let strongest = -1;
      let at = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        const row = ((crop.y + y * scale + dy) * size + crop.x + x * scale) * bands;
        for (let dx = 0; dx < scale; dx += 1) {
          const value = tile[row + dx * bands];
          if (value > strongest) {
            strongest = value;
            at = row + dx * bands;
          }
        }
      }
      const to = (y * width + x) * bands;
      out[to] = strongest;
      if (bands === 2) out[to + 1] = tile[at + 1];
    }
  }
  return out;
}

/** What a piece of `width` by `height` pixels and `bands` bytes a pixel costs to keep. */
export function pieceCost(width: number, height: number, bands: number): number {
  return PIECE_OVERHEAD + width * height * bands;
}

/** Whether `inner` lies within `outer`, give or take a rounding. */
export function covers(outer: Box, inner: Box): boolean {
  const slack = (outer[2] - outer[0]) * 1e-6;
  return inner[0] >= outer[0] - slack && inner[1] >= outer[1] - slack
    && inner[2] <= outer[2] + slack && inner[3] <= outer[3] + slack;
}

/** Whether two rectangles share any ground: touching is not sharing. */
export function meets(a: Box, b: Box): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** One coarse tile's part of a frame, as kept. */
export interface PreviewPiece {
  /** What tells it apart from any other: the tile, how it was cut, and the crop. */
  key: string;
  /** The frame it is of (a `ValueFrame`'s key). */
  frame: string;
  z: number;
  x: number;
  y: number;
  /** The ground its pixels cover. */
  covers: number[];
  width: number;
  height: number;
  /** Its packed values, as a decoded tile's; or that there is nothing to draw there. */
  tile: DecodedTile;
}

/**
 * The pieces of the plan in hand, by frame and coarse tile, and those of
 * the plans before it for as long as there is room.
 *
 * Only what the plan names is taken in (`plan`): a piece loaded for a view
 * since left is refused. What an earlier plan named is not let go at once,
 * though: the map moved or zoomed is planned afresh, every piece under
 * another name, and the frame on screen may have nothing but its old piece
 * to be drawn from until the new one is in. Those go, the oldest first,
 * only as the plan's own need their room. Past `capacity` a piece of the
 * plan is refused: a plan names no more than fit (`pieceCost`), the frames
 * nearest the needle first.
 */
export class PreviewStore {
  /** By key, in the order they were kept. */
  private readonly pieces = new Map<string, PreviewPiece>();

  /** By frame, then by `z/x/y`. */
  private readonly frames = new Map<string, Map<string, PreviewPiece>>();

  private wanted: ReadonlySet<string> = new Set();

  private readonly listeners = new Set<(piece: PreviewPiece) => void>();

  private used = 0;

  /** The most bytes held at once. */
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** The bytes held now. */
  get bytes(): number {
    return this.used;
  }

  /** How many pieces are held. */
  get size(): number {
    return this.pieces.size;
  }

  has(key: string): boolean {
    return this.pieces.has(key);
  }

  /** The keys taken in from now on; what is held under others stays while there is room. */
  plan(keys: Iterable<string>): void {
    this.wanted = new Set(keys);
  }

  /** Let every piece go, and take none in until the next plan. */
  clear(): void {
    this.pieces.clear();
    this.frames.clear();
    this.wanted = new Set();
    this.used = 0;
  }

  /** Keep a piece of the plan; false where it is not kept. */
  put(piece: PreviewPiece): boolean {
    if (!this.wanted.has(piece.key)) return false;
    const held = this.pieces.get(piece.key);
    if (held) this.remove(held);
    // A frame has one piece a coarse tile: a newer crop of it replaces the last.
    const at = `${piece.z}/${piece.x}/${piece.y}`;
    const before = this.frames.get(piece.frame)?.get(at);
    if (before) this.remove(before);
    const cost = costOf(piece);
    // Room is made of what no plan names any more, the oldest first.
    for (const other of this.pieces.values()) {
      if (this.used + cost <= this.capacity) break;
      if (!this.wanted.has(other.key)) this.remove(other);
    }
    if (this.used + cost > this.capacity) return false;
    let ofFrame = this.frames.get(piece.frame);
    if (!ofFrame) {
      ofFrame = new Map();
      this.frames.set(piece.frame, ofFrame);
    }
    ofFrame.set(at, piece);
    this.pieces.set(piece.key, piece);
    this.used += cost;
    for (const listener of [...this.listeners]) listener(piece);
    return true;
  }

  /** The piece of `frame` cut from coarse tile `z`/`x`/`y`; undefined where there is none. */
  find(frame: string, z: number, x: number, y: number): PreviewPiece | undefined {
    return this.frames.get(frame)?.get(`${z}/${x}/${y}`);
  }

  /**
   * The piece of `frame` that covers `ground`, which lies in tile
   * `z`/`x`/`y`: the nearest of the tiles above it, at most `depth` zooms
   * up. With `partly`, one that covers only some of the ground will do.
   */
  covering(
    frame: string, z: number, x: number, y: number, ground: Box, partly = false, depth = PREVIEW_ZOOMS + 2,
  ): PreviewPiece | undefined {
    const ofFrame = this.frames.get(frame);
    if (!ofFrame) return undefined;
    for (let up = 1; up <= depth && z - up >= 0; up += 1) {
      const piece = ofFrame.get(`${z - up}/${x >> up}/${y >> up}`);
      if (piece && (partly ? meets(piece.covers, ground) : covers(piece.covers, ground))) return piece;
    }
    return undefined;
  }

  /** Told each piece that is kept, until the returned function is called. */
  onPut(listener: (piece: PreviewPiece) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private remove(piece: PreviewPiece): void {
    if (this.pieces.get(piece.key) !== piece) return;
    this.pieces.delete(piece.key);
    this.used -= costOf(piece);
    const ofFrame = this.frames.get(piece.frame);
    const at = `${piece.z}/${piece.x}/${piece.y}`;
    if (ofFrame?.get(at) === piece) ofFrame.delete(at);
    if (ofFrame && !ofFrame.size) this.frames.delete(piece.frame);
  }
}

function costOf(piece: PreviewPiece): number {
  return PIECE_OVERHEAD + (piece.tile === BLANK ? 0 : piece.tile.byteLength);
}
