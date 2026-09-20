/**
 * Keeping the page itself at 1:1.
 *
 * The map has a zoom. The page around it must not: a chrome layout pinned to
 * the viewport with safe-area insets and a bottom tray has nowhere sensible to
 * go once the browser scales it, and there is no visible control to get back --
 * you are just left with half a toolbar off the edge of the screen.
 *
 * Most of that is done in CSS and in the viewport meta (`touch-action: pan-x
 * pan-y` on everything, `user-scalable=no`). This is the part that cannot be:
 * iOS Safari has ignored `user-scalable=no` since iOS 10, on purpose, and
 * answers a pinch with its own `gesture*` events regardless of what the meta
 * says. Cancelling those is what actually holds the page still there.
 *
 * It does not touch the map's own pinch-to-zoom, which OpenLayers drives from
 * pointer events and implements itself -- these events are the browser offering
 * to scale the document, and only that.
 */

/** Non-standard, iOS only; typed here rather than pulled in from anywhere. */
const GESTURES = ["gesturestart", "gesturechange", "gestureend"] as const;

let teardown: Array<() => void> = [];

function block(event: Event) {
  event.preventDefault();
}

/**
 * Start holding the page at 1:1. Idempotent: the entrypoints and a hot reload
 * can both reach it, and a stacked listener here would be invisible.
 */
export function initPageZoomGuard() {
  cleanupPageZoomGuard();
  if (typeof document === "undefined") return;
  for (const name of GESTURES) {
    /* Not passive: the whole point is to cancel it. Listeners on document are
       passive by default for some touch events, and a passive one that calls
       preventDefault() is ignored with a console warning. */
    document.addEventListener(name, block, { passive: false });
    teardown.push(() => document.removeEventListener(name, block));
  }
}

export function cleanupPageZoomGuard() {
  teardown.forEach((off) => off());
  teardown = [];
}
