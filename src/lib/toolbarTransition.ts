/**
 * The bottom bars announce their `fly` transitions so geometry that depends on
 * them can re-measure while they move.
 *
 * A transform-based transition never changes the element's box, so a
 * ResizeObserver on the bar sees nothing and anything sized against it -- the
 * map's height, the playback button alignment -- is measured once at the start
 * of the animation and left stale for the 200-400ms it runs.
 *
 * Dispatched on `window` rather than passed as props because the listeners
 * (Map.svelte, NowcastPlayback.svelte) are siblings of the emitters, not
 * ancestors.
 */
export const TOOLBAR_TRANSITION_EVENT = "mc:toolbar-transition";

export type ToolbarTransitionPhase = "start" | "end";

export interface ToolbarTransitionDetail {
  phase: ToolbarTransitionPhase;
}

function emit(phase: ToolbarTransitionPhase) {
  window.dispatchEvent(
    new CustomEvent<ToolbarTransitionDetail>(TOOLBAR_TRANSITION_EVENT, { detail: { phase } }),
  );
}

/**
 * Bound to the element carrying `transition:fly`, with Svelte's `on:` syntax:
 *
 *   on:introstart={toolbarTransitionStart} on:introend={toolbarTransitionEnd}
 *   on:outrostart={toolbarTransitionStart} on:outroend={toolbarTransitionEnd}
 *
 * Spreading an object of `onintrostart`-style keys does not work in these
 * components -- they are still in Svelte 5's legacy event mode, where a spread
 * of `on*` properties is applied as plain attributes and never fires.
 */
export const toolbarTransitionStart = () => emit("start");
export const toolbarTransitionEnd = () => emit("end");
