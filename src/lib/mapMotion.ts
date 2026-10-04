import type { FrameState } from "ol/Map";

/**
 * Whether the flat map on screen is moving, for the things that are cheaper
 * done differently while it does: the glass drops its blur (layers/ui.ts) and
 * the decluttered labels stop being placed afresh every frame
 * (layers/frozenDeclutter.ts).
 *
 * LayerManager reports the main map's movestart and moveend. Listeners hear
 * `true` at once and `false` only once the map has been still for
 * `SETTLE_MS`, so the gap between two wheel notches, or a pinch lifted and
 * put down again, is not a stop and a start -- each of which costs a full
 * redraw of what changed.
 */

/** How long the map has to be still before it counts as stopped. */
export const SETTLE_MS = 250;

/**
 * `frameState`, on a start, is the last frame drawn at rest: what movestart
 * hands over, and what the labels were last placed in.
 */
export type MotionListener = (moving: boolean, frameState?: FrameState | null) => void;

const listeners = new Set<MotionListener>();
let moving = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Hear the map start and stop moving. Returns the way to stop listening. */
export function onMapMotion(listener: MotionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Report the main map starting (`true`) or coming to rest (`false`). */
export function reportMapMotion(now: boolean, frameState?: FrameState | null) {
  clearTimeout(settleTimer);
  settleTimer = undefined;
  if (now) {
    if (moving) return;
    moving = true;
    listeners.forEach((listener) => listener(true, frameState));
    return;
  }
  if (!moving) return;
  settleTimer = setTimeout(() => {
    settleTimer = undefined;
    moving = false;
    listeners.forEach((listener) => listener(false));
  }, SETTLE_MS);
}
