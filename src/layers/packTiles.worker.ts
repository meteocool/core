import { packValues } from "../lib/packPixels";
import { tileValues } from "./tileValues";
import type { Context2D } from "./tileValues";
import type { Extent, MaskPath } from "./tileMask";

/**
 * Where value tiles are decoded, cut and packed, off the page's thread; see
 * packTiles.ts.
 *
 * The canvas is the worker's own and kept in memory rather than on the GPU
 * (`willReadFrequently`), since every cut drawn on it is read straight back.
 */

export interface PackJob {
  id: number;
  /** The tile's PNG, as fetched. */
  png: ArrayBuffer;
  /** The size the source expects: a packed tile's dimensions are only implied by it. */
  size: number;
  /** Past a frame's deepest zoom, the part of the tile this one is; see lib/tileIndex.ts. */
  scale: number;
  column: number;
  row: number;
  extent: Extent;
  /** Mask paths, by the ids `paths` (in this job or an earlier one) gave them. */
  erase: number[];
  keep: number | null;
  paths: [number, MaskPath][];
}

export type PackReply =
  | { id: number; data: Uint8Array }
  /** Not packed: no canvas here to cut it on. The PNG, handed back for the page to do it. */
  | { id: number; png: ArrayBuffer }
  /** Not packed, and nothing to be done about it: not a tile. */
  | { id: number; failed: string };

/* Typed by hand: the webworker lib cannot sit in one program with the DOM's. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PackJob>) => void) | null;
  postMessage(message: PackReply, transfer?: Transferable[]): void;
};
const paths = new Map<number, MaskPath>();

let context: OffscreenCanvasRenderingContext2D | null = null;
try {
  context = new OffscreenCanvas(512, 512).getContext("2d", { willReadFrequently: true });
} catch {
  // No 2D canvas in a worker here: every tile with a cut goes back to the page.
}

function canvas(size: number): Context2D | null {
  if (context && context.canvas.width !== size) {
    context.canvas.width = size;
    context.canvas.height = size;
  }
  return context;
}

scope.onmessage = async ({ data: job }: MessageEvent<PackJob>) => {
  for (const [id, path] of job.paths) paths.set(id, path);
  const erase = job.erase.map((id) => paths.get(id)!);
  const keep = job.keep === null ? null : paths.get(job.keep)!;
  try {
    const tile = await tileValues(job.png, job, job.extent, erase, keep, canvas);
    if (!tile) {
      scope.postMessage({ id: job.id, png: job.png } satisfies PackReply, [job.png]);
      return;
    }
    if (tile.size !== job.size) throw new Error(`a ${tile.size} px tile where ${job.size} px was asked for`);
    const data = packValues(tile.values, tile.coverage);
    scope.postMessage({ id: job.id, data } satisfies PackReply, [data.buffer]);
  } catch (error) {
    scope.postMessage({ id: job.id, failed: String(error) } satisfies PackReply);
  }
};
