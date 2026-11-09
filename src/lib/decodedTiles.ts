/**
 * Value tiles decoded ahead of playback, kept until OpenLayers asks for them.
 *
 * A step of playback re-points every radar layer at another frame, and each
 * of its tiles used to go the whole way again: OpenLayers' queue, the
 * service worker, the network or the HTTP cache, a worker to inflate and
 * pack it (layers/packTiles.ts), the GPU. Each link is quick; a viewport of
 * them for every layer, one after another, is most of a frame's 450 ms, and
 * OpenLayers draws each tile as it lands. So the frames ahead of the needle
 * are decoded here first (lib/framePreload.ts), and a source's loader that
 * finds its tile here answers at once (layers/valueTiles.ts), as the frame
 * layer uploads it at once (layers/radarFrames.ts).
 *
 * An entry is the very `Uint8Array` OpenLayers is handed, never a copy: while
 * OpenLayers keeps the tile, the two are one allocation. The store is bounded
 * by the bytes it holds, which is what a phone runs out of, and a frame the
 * plan still wants (`retain`) outlives one it no longer does, so a loop
 * longer than the store slides a window of frames ahead of the needle
 * instead of evicting the next frame to make room for the one after it.
 *
 * No OpenLayers here: what a tile is keyed by is the loader's to say
 * (`tileKey`), and what is kept is plain bytes.
 */

/** A tile the frame has nothing for: drawn as nothing, and no bytes to keep. */
export const BLANK: unique symbol = Symbol("blank");

/** A tile as kept: its packed values, or that there are none. */
export type DecodedTile = Uint8Array | typeof BLANK;

/**
 * What an entry costs besides its values: its key and its place in the map.
 * Also all a blank costs, so that a store of blanks is bounded too.
 */
export const ENTRY_OVERHEAD = 256;

/** How many tiles have to be held before their mean cost says anything. */
const MEAN_AFTER = 16;

/** The bytes an entry holds. */
export function costOf(tile: DecodedTile): number {
  return ENTRY_OVERHEAD + (tile === BLANK ? 0 : tile.byteLength);
}

/** Everything that decides a tile's bytes, as the loader is handed it. */
export interface TileKeyParts {
  /** The frame's tile template: which rendering. */
  template: string;
  z: number;
  x: number;
  y: number;
  /** The networks cut out of it, in a fixed order. */
  holes: readonly string[];
  /** The ground it is kept to, by a name of the caller's, or null for anywhere. */
  keep: string | null;
  /** The source's tile size: a packed tile's dimensions are only implied by it. */
  size: number;
}

/**
 * One tile's key: two requests share it exactly when the loader would give
 * them the same bytes. The frame's index is not in it, as the template names
 * the frame and the frame has one index.
 */
export function tileKey({ template, z, x, y, holes, keep, size }: TileKeyParts): string {
  return `${template}|${z}/${x}/${y}|${size}|${holes.join(",")}|${keep ?? ""}`;
}

/** An LRU of decoded tiles, bounded in bytes. */
export class DecodedTiles {
  /** In order of use, the least recent first. */
  private readonly entries = new Map<string, DecodedTile>();

  private retained: ReadonlySet<string> = new Set();

  private readonly listeners = new Set<(key: string) => void>();

  private used = 0;

  private generation = 0;

  /** The most bytes held at once. */
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** The bytes held now. */
  get bytes(): number {
    return this.used;
  }

  /**
   * What a tile held costs on average, or undefined while too few are held
   * to say: how a plan estimates the tiles it has yet to decode, most of
   * which, on a dry day or cut to a network's ground, are far less than a
   * full tile.
   */
  meanCost(): number | undefined {
    return this.entries.size >= MEAN_AFTER ? this.used / this.entries.size : undefined;
  }

  /** How many tiles are held. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Counts the times the store was emptied. Work started before the last
   * `clear` hands its result in with the count it started under, and is
   * refused: a tile decoded for a player since closed is not kept.
   */
  get epoch(): number {
    return this.generation;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** The tile, now the most recently used; undefined where it is not held. */
  get(key: string): DecodedTile | undefined {
    const tile = this.entries.get(key);
    if (tile === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, tile);
    return tile;
  }

  /** The tile, its place in the order of use left as it was; undefined where it is not held. */
  peek(key: string): DecodedTile | undefined {
    return this.entries.get(key);
  }

  /**
   * Keep a tile, letting the least recently used go past `capacity`: those
   * no plan retains first. False where it was not kept: decoded before the
   * last `clear`, or bigger than the whole store.
   */
  put(key: string, tile: DecodedTile, epoch = this.generation): boolean {
    if (epoch !== this.generation) return false;
    const cost = costOf(tile);
    if (cost > this.capacity) return false;
    this.remove(key);
    this.entries.set(key, tile);
    this.used += cost;
    this.evict();
    if (!this.entries.has(key)) return false;
    for (const listener of [...this.listeners]) listener(key);
    return true;
  }

  delete(key: string): void {
    this.remove(key);
  }

  /** The keys of these that are not held. */
  missing(keys: Iterable<string>): string[] {
    const absent: string[] = [];
    for (const key of keys) if (!this.entries.has(key)) absent.push(key);
    return absent;
  }

  /**
   * The keys the plan wants, which are let go only once every tile it does
   * not want is gone. Replaces the last call's.
   */
  retain(keys: Iterable<string>): void {
    this.retained = new Set(keys);
  }

  /** Let every tile go, and refuse any decoded before now. */
  clear(): void {
    this.entries.clear();
    this.used = 0;
    this.retained = new Set();
    this.generation += 1;
  }

  /** Told each key that is kept, from now until the returned function is called. */
  onPut(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Resolves true once every one of `keys` is held, or false after
   * `timeoutMs` or once `signal` aborts, whichever is first.
   */
  whenAll(keys: Iterable<string>, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const waiting = new Set(this.missing(keys));
    if (!waiting.size) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      let stop = () => {};
      const settle = (all: boolean) => {
        stop();
        resolve(all);
      };
      const unlisten = this.onPut((key) => {
        waiting.delete(key);
        if (!waiting.size) settle(true);
      });
      const timer = setTimeout(() => settle(false), timeoutMs);
      const aborted = () => settle(false);
      signal?.addEventListener("abort", aborted, { once: true });
      stop = () => {
        unlisten();
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
      };
    });
  }

  private remove(key: string): void {
    const tile = this.entries.get(key);
    if (tile === undefined) return;
    this.entries.delete(key);
    this.used -= costOf(tile);
  }

  /** The least recently used past `capacity`: unretained ones in a first pass, any in a second. */
  private evict(): void {
    for (const anyKey of [false, true]) {
      for (const key of this.entries.keys()) {
        if (this.used <= this.capacity) return;
        if (!anyKey && this.retained.has(key)) continue;
        this.remove(key);
      }
    }
  }
}
