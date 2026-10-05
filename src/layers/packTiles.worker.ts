import { cutTile } from "./tileMask";
import type { Extent, MaskPath } from "./tileMask";
import { packPixels } from "../lib/packPixels";

/**
 * Where value tiles are cut and packed, off the page's thread; see packTiles.ts.
 *
 * The canvas is the worker's own and kept in memory rather than on the GPU
 * (`willReadFrequently`), since every tile drawn into it is read straight
 * back out.
 */

export interface PackJob {
  id: number;
  image: ImageBitmap;
  /** Past a frame's deepest zoom, the part of `image` this tile is; see lib/tileIndex.ts. */
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
  /** Not packed: the image, handed back for the page to draw as it always did. */
  | { id: number; image: ImageBitmap }
  /** Not packed, and the image is gone with it. */
  | { id: number; failed: true };

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
  // No 2D canvas in a worker here: every image goes back unpacked.
}

scope.onmessage = ({ data: job }: MessageEvent<PackJob>) => {
  for (const [id, path] of job.paths) paths.set(id, path);
  const { image } = job;
  try {
    if (!context) throw new Error("no canvas");
    const size = image.width;
    const { canvas } = context;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    // Copy, not draw over: the last tile's pixels go, transparent ones included.
    context.globalCompositeOperation = "copy";
    context.imageSmoothingEnabled = false;
    if (job.scale === 1) {
      context.drawImage(image, 0, 0);
    } else {
      const part = size / job.scale;
      context.drawImage(image, job.column * part, job.row * part, part, part, 0, 0, size, size);
    }
    const erase = job.erase.map((id) => paths.get(id)!);
    const keep = job.keep === null ? null : paths.get(job.keep)!;
    if (erase.length || keep) cutTile(context, job.extent, erase, keep);
    const data = packPixels(context.getImageData(0, 0, size, size).data);
    image.close();
    scope.postMessage({ id: job.id, data } satisfies PackReply, [data.buffer]);
  } catch {
    // A closed bitmap is zero by zero, and cannot be handed back.
    if (image.width) scope.postMessage({ id: job.id, image } satisfies PackReply, [image]);
    else scope.postMessage({ id: job.id, failed: true } satisfies PackReply);
  }
};
