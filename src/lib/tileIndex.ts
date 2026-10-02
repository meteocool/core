/**
 * Which tiles a frame has, so the ones it lacks are never asked for.
 *
 * The renderer writes no tile that would be fully transparent, and the
 * composite is a tilted grid inside a rectangular extent -- so on a dry
 * afternoon most tiles inside the layer's extent do not exist, and every
 * frame of a loop asked for all of them and was refused. The frame now
 * carries an index: per zoom level, the rectangle its tiles fall in and one
 * bit per tile of it. A tile the index rules out is answered locally with a
 * blank, which OpenLayers draws as nothing.
 *
 * Kept free of OpenLayers so the decoding can be stated in a test. The
 * encoder is `tile_index` in meteocool/ng's worker-radar, and the two agree
 * on the layout: XYZ x, TMS y (the numbering the URL uses), row major from
 * the rectangle's corner, most significant bit first, base64.
 */

/** One zoom level's bitmap, as the API publishes it. */
export interface TileRows {
  x: number;
  y: number;
  w: number;
  h: number;
  bits: string;
}

/** A frame's index, by zoom level. */
export type TileIndex = Record<string, TileRows>;

const decoded = new WeakMap<TileRows, Uint8Array>();

function bitsOf(rows: TileRows): Uint8Array {
  let bytes = decoded.get(rows);
  if (!bytes) {
    const binary = atob(rows.bits);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    decoded.set(rows, bytes);
  }
  return bytes;
}

/**
 * Whether the frame has a tile at `z`/`x`/`tmsY`.
 *
 * True when the index says nothing about that zoom -- a frame from before the
 * index existed, or a zoom the renderer does not produce -- because then the
 * only way to know is to ask.
 */
export function hasTile(index: TileIndex | null | undefined, z: number, x: number, tmsY: number): boolean {
  const rows = index?.[String(z)];
  if (!rows) return true;
  const column = x - rows.x;
  const row = tmsY - rows.y;
  if (column < 0 || row < 0 || column >= rows.w || row >= rows.h) return false;
  const at = row * rows.w + column;
  const bytes = bitsOf(rows);
  const byte = bytes[at >> 3];
  return byte !== undefined && (byte & (0x80 >> (at & 7))) !== 0;
}

/**
 * The deepest zoom a frame has tiles at, or nothing when it carries no index.
 *
 * Not every frame goes as deep as the source asks: DWD's observed frame is
 * HX at 250 m, tiled to zoom 9, and its forecast WN at 1 km, tiled to 8.
 * Playback walks one source across both, so the source goes to 9 and a
 * forecast frame answers zoom 9 out of its zoom 8 tiles (`sourceTile`).
 */
export function deepestZoom(index: TileIndex | null | undefined): number | undefined {
  const zooms = Object.keys(index ?? {}).map(Number).filter(Number.isInteger);
  return zooms.length ? Math.max(...zooms) : undefined;
}

/** Which tile to draw a tile from, and which part of it: `scale` by `scale` parts, this one at `column`, `row`. */
export interface SourceTile {
  z: number;
  x: number;
  /** XYZ, like the tile asked for. */
  y: number;
  scale: number;
  column: number;
  row: number;
}

/**
 * Where a frame's tile `z`/`x`/`y` (XYZ) comes from: itself, or past the
 * frame's deepest zoom, the part of its ancestor there that covers it.
 */
export function sourceTile(index: TileIndex | null | undefined, z: number, x: number, y: number): SourceTile {
  const depth = deepestZoom(index);
  if (depth === undefined || z <= depth) return { z, x, y, scale: 1, column: 0, row: 0 };
  const scale = 2 ** (z - depth);
  const ancestorX = Math.floor(x / scale);
  const ancestorY = Math.floor(y / scale);
  return { z: depth, x: ancestorX, y: ancestorY, scale, column: x - ancestorX * scale, row: y - ancestorY * scale };
}
