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

/** Where a pull parks the panel with its action showing, in px. */
export const SWIPE_DETENT = 96;

/** How much of the finger's travel past the detent the panel actually takes. */
export const SWIPE_GIVE = 0.7;

/**
 * How far aside a panel is pulled, for a drag of `dx` (negative is leftward)
 * that started with it `from` px aside, on an element `width` wide.
 *
 * Up to the detent the panel tracks the finger exactly; past it only part of
 * the travel is taken, which is the resistance felt before it gives. A
 * rightward drag takes back what a leftward one opened, down to shut -- which
 * is how a parked panel is pushed closed again with the finger that opened it.
 */
export function pullTo(from: number, dx: number, width: number): number {
  const pulled = Math.max(0, from - dx);
  return pulled <= SWIPE_DETENT
    ? pulled
    : Math.min(width, SWIPE_DETENT + (pulled - SWIPE_DETENT) * SWIPE_GIVE);
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
  /** Called with the horizontal travel, in pixels (negative is leftward), as the finger moves. */
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
    // Both ways: a rightward drag pushes back what a leftward one opened. The
    // caller decides how far the element may go (see `pullTo`); clamping here
    // left a parked panel that no drag could push shut again.
    opts.onMove(dx);
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
