/**
 * When one radar source's picture moves on to its next frame, and what it
 * draws meanwhile.
 *
 * A step of playback used to re-point each radar layer at another frame and
 * let OpenLayers draw each new tile as it landed, the old frame's standing in
 * for the rest: for a moment the map was half one time and half another,
 * with coarse squares where nothing stood in. The frame layer
 * (layers/radarFrames.ts) instead keeps, for each source, the frame it shows
 * and the frame it is asked for (`FrameSwitch`), and moves from the one to
 * the other only once every tile of the new one the view needs is on the GPU
 * (`settled`): the whole picture at once, never two times in it. Until then
 * the old frame stays whole.
 *
 * Within the frame shown, a tile not yet there (the map panned or zoomed onto
 * new ground) is drawn from a coarser tile of the same frame that is
 * (`ancestorTile`), or from finer ones when zooming out (`childTiles`): of the
 * same time, blurrier for a moment.
 *
 * While playing, a move to the next frame fades the one into the other
 * (`fadeWeight`) in the values themselves, before the palette
 * (`blendTexel`): a cell drifts from one place to the next through the
 * intensities between, rather than one picture dissolving over another.
 *
 * No WebGL and no OpenLayers here; the shader in layers/radarFrames.ts
 * follows `blendTexel` exactly.
 */

/** What a frame needs to be told apart from another: two snapshots of one frame share a key. */
export interface Keyed {
  key: string;
}

/** The frame a source shows, the one it is asked for, and the one it is fading from. */
export class FrameSwitch<F extends Keyed> {
  /** What is drawn now: null before anything was asked for, or while hidden. */
  shown: F | null = null;

  /** What is asked for; the same as `shown` once it has been switched to. */
  wanted: F | null = null;

  /** The frame faded out of, while a fade lasts. */
  from: F | null = null;

  /** When the last switch happened, in the caller's clock. */
  switchedAt = 0;

  /**
   * Ask for a frame. With nothing shown yet it is shown at once and drawn as
   * its tiles come; else it waits for `settle`. A newer snapshot of the frame
   * shown (the same key) replaces it in place, and calls off a switch.
   */
  want(frame: F | null): void {
    if (frame && this.shown?.key === frame.key) {
      this.shown = frame;
      this.wanted = frame;
      return;
    }
    this.wanted = frame;
    if (!this.shown) this.shown = frame;
  }

  /** Whether another frame than the one shown is asked for. */
  get pending(): boolean {
    return this.wanted !== null && this.wanted.key !== this.shown?.key;
  }

  /**
   * Show the frame asked for, every tile it needs being ready: at `now`,
   * fading from the one shown when `fade`.
   */
  settle(now: number, fade: boolean): void {
    if (!this.pending) return;
    this.from = fade ? this.shown : null;
    this.shown = this.wanted;
    this.switchedAt = now;
  }

  /** How far the fade has come at `now`, 0 to 1; 1 once it is over, or when there is none. */
  fade(now: number, durationMs: number): number {
    if (!this.from) return 1;
    const t = fadeWeight(now - this.switchedAt, durationMs);
    if (t >= 1) this.from = null;
    return t;
  }

  /** Nothing shown: hidden, its next frame starts from nothing, drawn as it comes. */
  hide(): void {
    this.shown = null;
    this.from = null;
  }
}

/** How far into a fade of `durationMs` `elapsedMs` is, 0 to 1. No duration is no fade: 1. */
export function fadeWeight(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

/**
 * One pixel `t` of the way from value `a` to value `b`: the byte the palette
 * is looked up at, and how strongly what it gives is drawn.
 *
 * Both drawn (`drawn`, the palette's alpha there), the value between them,
 * rounded. One alone, its own value, fading out or in by `t`. Neither, nothing.
 */
export function blendTexel(a: number, b: number, t: number, drawn: (value: number) => boolean): { value: number; weight: number } {
  if (t >= 1) return { value: b, weight: 1 };
  const hasA = drawn(a);
  const hasB = drawn(b);
  if (hasA && hasB) return { value: Math.floor(a + (b - a) * t + 0.5), weight: 1 };
  if (hasA) return { value: a, weight: 1 - t };
  return { value: b, weight: hasB ? t : 0 };
}

/** A tile's place in the pyramid. */
export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * The nearest coarser tile, at most `depth` zooms up and not above `minZ`,
 * that `has` says is ready to draw; null where none is.
 */
export function ancestorTile(
  { z, x, y }: TileCoord, minZ: number, has: (tile: TileCoord) => boolean, depth = 2,
): TileCoord | null {
  for (let up = 1; up <= depth && z - up >= minZ; up++) {
    const tile = { z: z - up, x: x >> up, y: y >> up };
    if (has(tile)) return tile;
  }
  return null;
}

/** The four tiles one zoom finer that `has` says are ready, none past `maxZ`. */
export function childTiles({ z, x, y }: TileCoord, maxZ: number, has: (tile: TileCoord) => boolean): TileCoord[] {
  if (z + 1 > maxZ) return [];
  const children: TileCoord[] = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const tile = { z: z + 1, x: 2 * x + dx, y: 2 * y + dy };
    if (has(tile)) children.push(tile);
  }
  return children;
}

/** Whether a frame can be switched to: every one of its tiles is settled, drawn or known to draw nothing. */
export function settled<J>(jobs: Iterable<J>, ready: (job: J) => boolean): boolean {
  for (const job of jobs) if (!ready(job)) return false;
  return true;
}
