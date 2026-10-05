import { magnify } from "./indexedTiles";
import { maskTile } from "./tileMask";
import type { Extent, MaskPath } from "./tileMask";
import type { SourceTile } from "../lib/tileIndex";
import type { PackJob, PackReply } from "./packTiles.worker";

/**
 * Value tiles packed to their meaningful bytes, in workers; see lib/packPixels.ts.
 *
 * The radar layers keep hundreds of tiles -- a frame's worth for every step
 * of playback, for each network -- and each was an RGBA bitmap or canvas of a
 * megabyte, with a megabyte texture on the GPU beside it. On a phone that
 * was most of the page's memory after a few loops of playback. The network
 * tiles were canvases too, cut to their ground, and iOS caps what a page may
 * hold in canvases at a few hundred megabytes; past that they draw nothing.
 *
 * Packing means drawing the tile and reading it back, a millisecond a tile
 * on a laptop and several on a phone, so it happens here rather than on the
 * page's thread, together with the cut and the magnifying it already needed.
 * Where a worker cannot draw, the tile is drawn on the page as it was before.
 */

/** Two, so a burst of tiles -- a pan into new ground -- is not one queue. */
const WORKERS = 2;

interface Packer {
  worker: Worker;
  /** The mask paths this worker has been sent, by id. */
  known: Set<number>;
  waiting: number;
}

/** Undefined until first asked for; null where there are none. */
let packers: Packer[] | null | undefined;
const replies = new Map<number, (reply: PackReply | null) => void>();
let jobs = 0;
const pathIds = new WeakMap<MaskPath, number>();
let paths = 0;

function pool(): Packer[] | null {
  if (packers !== undefined) return packers;
  packers = null;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  try {
    packers = Array.from({ length: WORKERS }, () => {
      const worker = new Worker(new URL("./packTiles.worker.ts", import.meta.url), { type: "module" });
      const packer: Packer = { worker, known: new Set(), waiting: 0 };
      worker.onmessage = ({ data }: MessageEvent<PackReply>) => {
        packer.waiting -= 1;
        replies.get(data.id)?.(data);
        replies.delete(data.id);
      };
      // A worker that never loaded answers nothing: its tiles fail, and the
      // ones after it are drawn on the page.
      worker.onerror = () => {
        packers = null;
        for (const [id, reply] of replies) {
          reply(null);
          replies.delete(id);
        }
      };
      return packer;
    });
  } catch {
    packers = null;
  }
  return packers;
}

/** The tile drawn on the page, as before there were workers. */
function drawn(
  bitmap: ImageBitmap,
  from: Pick<SourceTile, "scale" | "column" | "row">,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
): ImageBitmap | HTMLCanvasElement {
  const image = magnify(bitmap, from);
  if (image !== bitmap) bitmap.close();
  if (!erase.length && !keep) return image;
  const cut = maskTile(image, extent, erase, keep);
  if (image instanceof ImageBitmap) image.close();
  return cut;
}

/**
 * The tile `from` names in `bitmap`, cut and packed.
 *
 * The bitmap is handed over: it is closed either way. `size` is the tile size
 * the source expects; a bitmap of any other is drawn on the page, since a
 * packed tile's dimensions are only implied by it.
 */
export function packValueTile(
  bitmap: ImageBitmap,
  from: Pick<SourceTile, "scale" | "column" | "row">,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
  size: number,
  signal?: AbortSignal,
): Promise<Uint8Array | ImageBitmap | HTMLCanvasElement> {
  const all = bitmap.width === size ? pool() : null;
  if (!all) return Promise.resolve(drawn(bitmap, from, extent, erase, keep));
  if (signal?.aborted) {
    bitmap.close();
    return Promise.reject(signal.reason);
  }
  const packer = all.reduce((least, next) => (next.waiting < least.waiting ? next : least));
  const sent: [number, MaskPath][] = [];
  const idOf = (path: MaskPath) => {
    let id = pathIds.get(path);
    if (id === undefined) {
      paths += 1;
      id = paths;
      pathIds.set(path, id);
    }
    if (!packer.known.has(id)) {
      packer.known.add(id);
      sent.push([id, path]);
    }
    return id;
  };
  jobs += 1;
  const job: PackJob = {
    id: jobs,
    image: bitmap,
    scale: from.scale,
    column: from.column,
    row: from.row,
    extent,
    erase: erase.map(idOf),
    keep: keep ? idOf(keep) : null,
    paths: sent,
  };
  return new Promise((resolve, reject) => {
    replies.set(job.id, (reply) => {
      if (reply && "data" in reply) resolve(reply.data);
      else if (reply && "image" in reply) resolve(drawn(reply.image, from, extent, erase, keep));
      else reject(new Error("value tile could not be packed"));
    });
    packer.waiting += 1;
    packer.worker.postMessage(job, [bitmap]);
  });
}
