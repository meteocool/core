/**
 * Whether playback moves on to its next frame, or holds the one on screen.
 *
 * A step re-points every radar layer at another frame, and OpenLayers draws
 * each tile of it as it lands, the last frame's standing in for the rest:
 * a step whose tiles were not ready showed a patchwork of two times, or
 * coarse squares where nothing stood in. So the tick asks first whether the
 * next frame's tiles for the map in view are decoded (lib/decodedTiles.ts),
 * and while they are not the frame on screen stays a little longer. Not for
 * ever: a slow link or a dead tile would freeze the loop, so after
 * `READY_TIMEOUT_MS` it moves on with whatever has come.
 *
 * Only while frames are being decoded ahead (lib/framePreload.ts): with
 * nothing filling the store, waiting would only ever time out. A hand on the
 * timeline is never held: the frame it asks for is shown at once. Nor is
 * playback held while the map itself is being zoomed or panned, where the
 * radar's frame layer draws it: the tiles a step needs change with every
 * moment of the move, so each step waited its whole timeout for tiles of a
 * zoom the map was only passing through, and the loop stood still for as
 * long as the fingers moved. The frame layer shows each step from what it
 * has, or keeps the one before whole.
 */
import type { PreloadMode } from "./framePreload";

/** The longest the frame on screen is held for the next one's tiles. */
export const READY_TIMEOUT_MS = 1500;

/**
 * Whether playback waits for a frame's tiles at all: only while they are
 * being decoded ahead, and not while the map is `moving` under a layer that
 * can show a step without them.
 */
export function holdsForTiles(mode: PreloadMode, moving = false): boolean {
  return !moving && (mode === "all" || mode === "ahead");
}

/** Whether to move on: the next frame is ready, or has been waited for long enough. */
export function shouldAdvance(ready: boolean, waitedMs: number, timeoutMs = READY_TIMEOUT_MS): boolean {
  return ready || waitedMs >= timeoutMs;
}

/** How much longer the frame on screen may be held, having been held `waitedMs` already. */
export function waitLeft(waitedMs: number, timeoutMs = READY_TIMEOUT_MS): number {
  return Math.max(0, timeoutMs - waitedMs);
}

/**
 * The steps playback will show from `from` on, `from` first, in the order it
 * shows them (`next`, the loop's own rule), until it comes round again or
 * `max` steps: what to decode ahead while playing. The needle's other side,
 * which a loop from now never visits, is not in it.
 */
export function playOrder(from: number, next: (shown: number) => number, max: number): number[] {
  const order = [from];
  const seen = new Set(order);
  while (order.length < max) {
    const step = next(order[order.length - 1]);
    if (seen.has(step)) break;
    seen.add(step);
    order.push(step);
  }
  return order;
}
