/**
 * Radar tiles uploaded to the GPU, kept for as long as a budget of bytes
 * allows.
 *
 * The frame layer (layers/radarFrames.ts) draws every frame of playback from
 * a texture per tile. Uploaded once, a tile is drawn again each time the loop
 * comes round to it without being fetched, decoded or uploaded again, which
 * is what makes a loop smooth; but a phone has far less room than a loop of
 * textures, so they are kept like the decoded tiles are (lib/decodedTiles.ts):
 * bounded by the bytes they hold, the least recently drawn let go first, the
 * frames the plan still wants (`retain`) after those it does not. A tile in
 * the picture on screen (`pin`) is never let go: deleting a texture the next
 * draw binds would leave a hole in the radar.
 *
 * A blank tile, one with nothing drawn, has no texture and costs no bytes;
 * it is kept so that it is known to be blank, and only so many entries are.
 *
 * No WebGL here: what a handle is, and how one is let go (`release`), is the
 * caller's to say.
 */
import { BLANK } from "./decodedTiles";

/** A tile as kept: its handle, or that it draws nothing. */
export type GpuTile<T> = T | typeof BLANK;

/** How many entries are kept at most, blanks included, whatever their bytes. */
export const MAX_GPU_ENTRIES = 8192;

interface Entry<T> {
  tile: GpuTile<T>;
  bytes: number;
}

/** An LRU of uploaded tiles, bounded in bytes. */
export class GpuTiles<T> {
  /** In order of use, the least recent first. */
  private readonly entries = new Map<string, Entry<T>>();

  private retained: ReadonlySet<string> = new Set();

  private readonly pinned = new Set<string>();

  private used = 0;

  /** The most bytes held at once, past which the unpinned are let go. */
  readonly capacity: number;

  private readonly release: (handle: T) => void;

  private readonly maxEntries: number;

  /** `release` lets a handle go: told of every tile evicted, deleted or cleared. */
  constructor(capacity: number, release: (handle: T) => void, maxEntries = MAX_GPU_ENTRIES) {
    this.capacity = capacity;
    this.release = release;
    this.maxEntries = maxEntries;
  }

  /** The bytes held now. */
  get bytes(): number {
    return this.used;
  }

  /** How many tiles are held, blanks included. */
  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** The tile, now the most recently used; undefined where it is not held. */
  get(key: string): GpuTile<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.tile;
  }

  /**
   * Keep a tile of `bytes`, replacing one held under its key, and let the
   * least recently used go past `capacity`.
   */
  put(key: string, tile: GpuTile<T>, bytes: number): void {
    this.delete(key);
    this.entries.set(key, { tile, bytes });
    this.used += bytes;
    this.evict();
  }

  /** Let a tile go. */
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.used -= entry.bytes;
    if (entry.tile !== BLANK) this.release(entry.tile);
  }

  /** The tiles the plan wants: let go only once no other unpinned tile is left to. Replaces the last call's. */
  retain(keys: Iterable<string>): void {
    this.retained = new Set(keys);
  }

  /** Keep a tile whatever the budget until `unpinAll`: it is in the picture being drawn. */
  pin(key: string): void {
    this.pinned.add(key);
  }

  /** Let every pinned tile be evicted again; those past `capacity` go now. */
  unpinAll(): void {
    this.pinned.clear();
    this.evict();
  }

  /** Let go of every tile not pinned, whatever the budget. */
  dropUnpinned(): void {
    for (const key of [...this.entries.keys()]) if (!this.pinned.has(key)) this.delete(key);
  }

  /**
   * Let go of every tile. `release` false where the handles are already gone
   * (a lost context took them with it), so nothing is asked to delete them.
   */
  clear(release = true): void {
    if (release) for (const { tile } of this.entries.values()) if (tile !== BLANK) this.release(tile);
    this.entries.clear();
    this.pinned.clear();
    this.used = 0;
  }

  /**
   * The least recently used past `capacity` or `maxEntries`: unretained ones
   * in a first pass, retained ones in a second, never a pinned one.
   */
  private evict(): void {
    const over = () => this.used > this.capacity || this.entries.size > this.maxEntries;
    if (!over()) return;
    for (const anyKey of [false, true]) {
      for (const key of [...this.entries.keys()]) {
        if (!over()) return;
        if (this.pinned.has(key) || (!anyKey && this.retained.has(key))) continue;
        this.delete(key);
      }
    }
  }
}
