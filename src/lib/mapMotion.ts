/**
 * Whether the flat map on screen is moving, for the things that are done
 * differently while it does: the glass can drop its blur (layers/ui.ts), and
 * a touch device's first moves are timed (lib/slowDevice.ts).
 *
 * Not for anything that changes how OpenLayers draws: a vector layer does not
 * rebuild what it draws while the map is being moved, so switching, say,
 * label decluttering off for a drag left the cells, the storm tags and the
 * no-radar wash drawn for the other mode, and not drawn at all.
 *
 * LayerManager reports the main map's movestart and moveend. Listeners hear
 * `true` at once and `false` only once the map has been still for
 * `SETTLE_MS`, so the gap between two wheel notches, or a pinch lifted and
 * put down again, is not a stop and a start -- each of which costs a full
 * redraw of what changed.
 */

/** How long the map has to be still before it counts as stopped. */
export const SETTLE_MS = 250;

export type MotionListener = (moving: boolean) => void;

const listeners = new Set<MotionListener>();
let moving = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Hear the map start and stop moving. Returns the way to stop listening. */
export function onMapMotion(listener: MotionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Report the main map starting (`true`) or coming to rest (`false`). */
export function reportMapMotion(now: boolean) {
  clearTimeout(settleTimer);
  settleTimer = undefined;
  if (now) {
    if (moving) return;
    moving = true;
    listeners.forEach((listener) => listener(true));
    return;
  }
  if (!moving) return;
  settleTimer = setTimeout(() => {
    settleTimer = undefined;
    moving = false;
    listeners.forEach((listener) => listener(false));
  }, SETTLE_MS);
}
