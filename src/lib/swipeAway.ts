/**
 * Swipe left to clear, as an action everything that does it shares.
 *
 * The strips at the bottom of the map clear this way, and so does the cell
 * hint bar -- through the same dock (components/SwipeDock.svelte), which
 * parks the panel at a detent to show the action under it and takes it off
 * the edge past the commit point. What has to match between them is not the
 * look but the feel, and the feel is almost all in one rule -- when a drag
 * stops being a tap and which way it counts as going -- so that rule lives
 * here rather than being written out twice and drifting.
 *
 * This reports the travel and leaves the meaning to the caller: the dock
 * turns it into a reveal, and anything else is free to turn it into
 * something else.
 */

/**
 * How far a pointer moves before it is a swipe rather than a press.
 *
 * Small enough not to feel laggy, large enough that a tap with a thumb -- which
 * always moves a pixel or two -- still reaches the button under it. Every
 * control inside a swipeable thing depends on this: below it, nothing is
 * swallowed.
 */
export const SWIPE_SLOP = 6;

/** Past this share of the element's width, letting go clears it. */
export const SWIPE_COMMIT = 0.45;

export type SwipeAxis = "undecided" | "x" | "y";

/**
 * Which way a gesture is going, once it has gone far enough to say.
 *
 * Decided once and then kept, so a swipe that curves does not change its mind
 * half way and leave the element parked between two states. A vertical answer
 * means hands off: the page below scrolls, or the sheet takes the drag.
 */
export function decideAxis(dx: number, dy: number, slop = SWIPE_SLOP): SwipeAxis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "undecided";
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** Whether a leftward travel of `dx` over `width` is far enough to clear. */
export function shouldClear(dx: number, width: number, commit = SWIPE_COMMIT): boolean {
  return width > 0 && -dx >= width * commit;
}

export interface SwipeAwayOptions {
  /**
   * Called once a press has turned into a horizontal swipe: the moment to
   * measure the element and stop animating it, since the finger has it now.
   */
  onStart?: (node: HTMLElement) => void;
  /** Called with the leftward travel, in pixels, as the finger moves. */
  onMove: (dx: number) => void;
  /** Called on release: `cleared` says whether it went far enough. */
  onEnd: (cleared: boolean) => void;
}

/**
 * The Svelte action: pointer plumbing, axis decision, capture.
 *
 * Only horizontal gestures are captured, and only after the axis is settled, so
 * a vertical drag inside a scrolling sheet is left alone rather than swallowed
 * half way through. `lostpointercapture` is handled as an end because capture
 * can be taken away without a `pointerup` ever arriving -- a system gesture
 * claiming the touch, the node being re-laid-out under it -- and without it the
 * element stays parked mid-drag and ignores every later touch.
 */
export function swipeAway(node: HTMLElement, options: SwipeAwayOptions) {
  let opts = options;
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let axis: SwipeAxis = "undecided";

  function onDown(event: PointerEvent) {
    if (pointer !== null || event.button > 0) return;
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    axis = "undecided";
  }

  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === "undecided") {
      axis = decideAxis(dx, dy);
      if (axis !== "x") return;
      try { node.setPointerCapture(event.pointerId); } catch { /* already gone */ }
      opts.onStart?.(node);
    }
    if (axis !== "x") return;
    // Leftward only: there is nothing to the right to reveal, and letting the
    // element follow a rightward drag makes it look loose.
    opts.onMove(Math.min(0, dx));
  }

  function onUp(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    try {
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    } catch { /* already gone */ }
    const horizontal = axis === "x";
    axis = "undecided";
    if (!horizontal) return;
    const dx = Math.min(0, event.clientX - startX);
    opts.onEnd(shouldClear(dx, node.getBoundingClientRect().width));
  }

  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onUp);
  node.addEventListener("lostpointercapture", onUp);

  return {
    update(next: SwipeAwayOptions) { opts = next; },
    destroy() {
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.removeEventListener("lostpointercapture", onUp);
    },
  };
}
