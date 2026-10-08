import { packValues } from "../lib/packPixels";
import { pageCanvas, tileValues } from "./tileValues";
import type { Extent, MaskPath } from "./tileMask";
import type { SourceTile } from "../lib/tileIndex";
import type { PackJob, PackReply } from "./packTiles.worker";

/**
 * Value tiles decoded and packed to their meaningful bytes, in workers; see
 * lib/valuePng.ts and lib/packPixels.ts.
 *
 * The radar layers keep hundreds of tiles (a frame's worth for every step
 * of playback, for each network), and each was an RGBA bitmap or canvas of a
 * megabyte, with a megabyte texture on the GPU beside it. On a phone that
 * was most of the page's memory after a few loops of playback. The network
 * tiles were canvases too, cut to their ground, and iOS caps what a page may
 * hold in canvases at a few hundred megabytes; past that they draw nothing.
 * Packed, a tile is its values alone, a quarter of that, and never a canvas.
 *
 * Decoding a PNG and cutting the tile take a few milliseconds a tile on a
 * phone, so they happen here rather than on the page's thread. Where a
 * worker cannot, the page does the same.
 */

/** Two, so a burst of tiles (a pan into new ground) is not one queue. */
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
      // ones after it are packed on the page.
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

/** The tile packed on the page, as a worker would. */
async function packedOnPage(
  png: ArrayBuffer,
  from: Pick<SourceTile, "scale" | "column" | "row">,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
  size: number,
): Promise<Uint8Array> {
  const tile = await tileValues(png, from, extent, erase, keep, pageCanvas);
  if (!tile) throw new Error("no canvas to cut a tile on");
  if (tile.size !== size) throw new Error(`a ${tile.size} px tile where ${size} px was asked for`);
  return packValues(tile.values, tile.coverage);
}

/**
 * The tile `from` names in `png`, decoded, cut and packed.
 *
 * The PNG is handed over. `size` is the tile size the source expects: a
 * packed tile's dimensions are only implied by it, so a tile of any other
 * fails.
 */
export function packValueTile(
  png: ArrayBuffer,
  from: Pick<SourceTile, "scale" | "column" | "row">,
  extent: Extent,
  erase: MaskPath[],
  keep: MaskPath | null,
  size: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const all = pool();
  if (!all) return packedOnPage(png, from, extent, erase, keep, size);
  if (signal?.aborted) return Promise.reject(signal.reason);
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
    png,
    size,
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
      else if (reply && "png" in reply) resolve(packedOnPage(reply.png, from, extent, erase, keep, size));
      else reject(new Error(reply ? `value tile could not be packed: ${reply.failed}` : "value tile could not be packed"));
    });
    packer.waiting += 1;
    packer.worker.postMessage(job, [png]);
  });
}
