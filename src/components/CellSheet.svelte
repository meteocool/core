<script lang="ts">
/**
 * The detail panel as a sheet, on a phone.
 *
 * A card floating in the corner is a desktop idea: it assumes a map big enough
 * that something can sit on top of it without being in the way. On a phone
 * there is no such corner, so the panel comes up from the bottom edge instead
 * -- anchored to the thumb, over a map that stays visible above it, dismissed
 * by pulling it back down. That is the shape every modern phone UI uses for
 * exactly this, which is the argument for it: a reader already knows what to
 * do with a sheet without being told.
 *
 * Glass rather than the desktop panel's solid fill, so the map keeps showing
 * through the edges and the sheet reads as floating over it rather than as a
 * second screen that replaced it.
 */
import { fly } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import { onDestroy } from "svelte";
import { get } from "svelte/store";
import { cellDetails, sharedActiveCap } from "../stores";
import { afterClose } from "../lib/cellSelection";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { decideAxis, type SwipeAxis } from "../lib/swipeAway";
import CellDetails from "./CellDetails.svelte";

/**
 * The cell whose details fill the sheet -- or none, when something else is
 * given as its content: a storm core on the 3D map takes the same sheet, so a
 * phone has one surface for "the storm you tapped", whatever kind it is.
 */
export let track: import("../api").CellTrackProperties | null = null;
/** What dismissing the sheet does, when it is not a cell's details closing. */
export let onClose: (() => void) | null = null;
/**
 * Whether it pulls up to full height. Not for content that already fits at
 * rest -- and a sheet that does not is as tall as what it holds, so a few
 * facts and a dial are neither clipped nor floating in a half-empty panel.
 */
export let expandable = true;

/**
 * The sheet slides, unless the reader has asked things not to move.
 *
 * `prefers-reduced-motion` is honoured in CSS everywhere else here, but a
 * Svelte transition is not CSS the stylesheet can reach, so it is read once at
 * construction and turned into a duration.
 */
const reducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const slide = { y: 400, duration: reducedMotion ? 0 : 320, easing: cubicOut };

const close = () => {
  if (onClose) onClose();
  else if (track) cellDetails.set(afterClose({ code: track.code, details: true }, true).details);
};

/* ---- how much of the screen the sheet takes ----------------------------- */

/**
 * Two heights, not one.
 *
 * At one height the sheet had to pick between being readable and leaving the
 * map visible, and it picked readable: 82% of the screen, with the family
 * graph below the fold. That is the wrong trade for the graph in particular,
 * because the graph is a thing you navigate *with* -- tapping a node moves the
 * selection on the map, and if the map is a strip at the top there is nothing
 * to see it move on.
 *
 * So the sheet opens half height, which leaves the map the other half, and
 * goes full when there is reading to do. Dragging the grabber moves between
 * them; dragging down from half dismisses, which keeps one gesture meaning one
 * thing all the way down.
 */
/*
 * The short one is sized to the family chart, which is what the reader is
 * usually here for when they want the map too.
 *
 * It was 52%, from when the chart was laid out downwards and ran to 500px.
 * Sideways it is about 170 tall, and the section around it -- heading, chart,
 * the recency line under it -- comes to roughly 300 including the grabber and
 * the sheet's own padding. 40% of a 812pt phone is 325, which holds that with
 * a little over, and hands the other 60% back to the map.
 */
/*
 * Shorter on the 3D map, where the storm the reader opened stands on the map
 * itself, cut open, and the sheet's job is the readings and the dial that
 * turns the cut -- neither of which needs the family chart's room. A third of
 * the screen holds the header, the dial and the first readings, and leaves
 * the storm the rest. Read once: a sheet lives for one selection, and the map
 * does not change under an open one.
 */
const HALF = get(sharedActiveCap) === "cells3d" ? 0.32 : 0.4;
// Short of the full screen on purpose: a strip of map stays visible above the
// sheet so it reads as a drawer sitting over the map rather than a second
// screen, and there is something to see the grip is still draggable toward.
// A bare vh fraction cannot know how tall the status bar or a dynamic island
// is, and that varies by device -- so this is deliberately higher than the
// sheet is ever meant to render at; the .sheet CSS clamps the real height
// against --mc-safe-top instead, which is what actually keeps the grip clear
// of that chrome on every phone rather than on the one this was tuned on.
const FULL = 0.95;

let detent = HALF;

/**
 * At FULL the sheet covers the native buttons floating on top of the
 * webview (layer switcher, settings, location, logo) -- CSS can hide the
 * web toolbar underneath but has no reach into that native layer, so the
 * host app is told directly. Tapping a different cell can drop straight
 * from FULL to unmounted (nextSelection closes the panel instead of
 * stepping it down to HALF first), so `onDestroy` re-shows the buttons
 * unconditionally rather than trusting the last detent seen.
 */
let sheetExpandedNative = false;

function syncNativeChrome(expanded: boolean) {
  if (!dd.isIos() || expanded === sheetExpandedNative) return;
  sheetExpandedNative = expanded;
  window.webkit?.messageHandlers.scriptHandler.postMessage(
    expanded ? "detailSheetExpanded" : "detailSheetCollapsed",
  );
}

$: syncNativeChrome(detent === FULL);

onDestroy(() => syncNativeChrome(false));

/* ---- drag the grabber --------------------------------------------------- */

/**
 * The grabber is draggable, not decorative.
 *
 * A sheet with a handle that does not move is a worse lie than no handle: the
 * shape promises the gesture, and a reader who tries it and gets nothing
 * learns the UI is fake rather than that they were wrong. So the drag is real,
 * and it follows the finger -- upward as well now, because there is somewhere
 * above to go.
 */
let dragY = 0;
let dragging = false;
let startY = 0;
let sheetEl: HTMLElement;
/** How far below the screen's edge the sheet's lower part sits, at rest. */
let restPx = 0;

/** Far enough that the drag was meant, short enough to be one easy motion. */
const SNAP_PX = 60;

/**
 * The sheet is always laid out at full height and parked with its lower part
 * below the screen's edge, so dragging it up slides in what is already there.
 * That parked distance is CSS (vh against the safe area), so it is measured
 * rather than recomputed: how far the sheet's bottom hangs past its parent's.
 */
function startDrag(y: number) {
  dragging = true;
  startY = y;
  const parent = sheetEl.offsetParent ?? document.documentElement;
  restPx = Math.max(0, sheetEl.getBoundingClientRect().bottom - parent.getBoundingClientRect().bottom);
}

function grab(event: PointerEvent) {
  startDrag(event.clientY);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (!dragging) return;
  const delta = event.clientY - startY;
  // Upward only as far as the full detent is from here, so the sheet cannot be
  // dragged off the top of the screen and left there.
  const headroom = detent === HALF && expandable ? -restPx : 0;
  dragY = Math.max(headroom, delta);
}

function release() {
  if (!dragging) return;
  dragging = false;
  const moved = dragY;
  dragY = 0;
  if (moved < -SNAP_PX) {
    if (expandable) detent = FULL;
  } else if (moved > SNAP_PX) {
    // Down from full lands on half; down from half lets go of the cell.
    if (detent === FULL) detent = HALF;
    else close();
  }
}

/* ---- drag the body, when it has nothing of its own to scroll ------------ */

/**
 * A grip 44px tall is still a small target on a panel most of which is this.
 * When the content fits without scrolling there is nothing for a vertical
 * drag here to do *but* move the sheet, so it gets to -- the same detent
 * snapping as the grip, from wherever the thumb actually lands.
 *
 * Two things stay out of that: a drag that turns out to be a tap on a control
 * in here (the close button, a link), and the 3D model, which already owns
 * its own vertical drag to turn the shape and would never get it back once a
 * few pixels of "is this a resize" slop ran out first. The cut's dial is not
 * one of them: it turns sideways only and lets a vertical drag go uncaptured,
 * deciding with the same rule as below, so the sheet takes it from there.
 *
 * The axis decision is the same slop-then-commit rule swipeAway.ts uses for
 * the strips' swipe-to-clear -- proven here at working out "tap or gesture"
 * without it, a plain tap on anything in the body would start a drag before
 * the tap underneath it ever got the event.
 */
let bodyPointer: number | null = null;
let bodyStartX = 0;
let bodyStartY = 0;
let bodyAxis: SwipeAxis = "undecided";
let bodyEligible = false;

function bodyDown(event: PointerEvent) {
  if (event.button > 0) return;
  // The model owns its drags; see above.
  if ((event.target as HTMLElement).closest(".model")) return;
  const el = event.currentTarget as HTMLElement;
  bodyEligible = el.scrollHeight <= el.clientHeight + 1;
  if (!bodyEligible) return;
  bodyPointer = event.pointerId;
  bodyStartX = event.clientX;
  bodyStartY = event.clientY;
  bodyAxis = "undecided";
}

function bodyMove(event: PointerEvent) {
  if (!bodyEligible || event.pointerId !== bodyPointer) return;
  if (bodyAxis === "undecided") {
    bodyAxis = decideAxis(event.clientX - bodyStartX, event.clientY - bodyStartY);
    if (bodyAxis !== "y") return;
    startDrag(bodyStartY);
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* already gone */ }
  }
  if (bodyAxis !== "y") return;
  move(event);
}

function bodyUp(event: PointerEvent) {
  if (event.pointerId !== bodyPointer) return;
  bodyPointer = null;
  const wasDragging = bodyAxis === "y";
  bodyAxis = "undecided";
  bodyEligible = false;
  if (wasDragging) release();
}
</script>

<style>
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--mc-z-details);
    display: flex;
    flex-direction: column;
    /* Set from the detent, so the map above always has the rest -- except at
       FULL, where the detent alone is not trusted: env(safe-area-inset-top)
       is the one number that actually knows the status bar / dynamic island
       height on this device, so the real cap is measured from that rather
       than a vh guess that put the grip behind it on some phones. The 60px
       past that clears the status bar with real room to spare -- 28px read as
       "no map visible" since it barely cleared the chrome at all. */
    --full-h: min(95vh, calc(100vh - var(--mc-safe-top) - 60px));
    height: var(--full-h);
    /* Always that tall, and slid down by however much the detent leaves off,
       so the part below the fold is laid out and waiting under the screen's
       edge. Sized to the detent instead, pulling it up dragged a half-height
       panel into the air with bare map underneath until the finger let go. */
    --rest: max(0px, calc(var(--full-h) - var(--sheet-h)));
    transform: translateY(calc(var(--rest) + var(--drag, 0px)));
    padding: 0 12px calc(12px + var(--mc-safe-bottom));
    border-radius: 22px 22px 0 0;
    /* The tray tokens are built for a pill with three words on it. This is two
       charts, a 3D model and thirty numbers, over a radar composite running
       green to magenta: at --mc-glass-fill-strong the colours come through and
       the text sits in a rainbow. So the sheet takes the panel's own themed
       fill -- which flips light and dark with the rest of the UI, as the tray
       tokens do not -- and gives back just enough of it to keep the map
       showing at the edges. */
    background: var(--sl-panel-background-color, #fff);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border-top: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring-lg);
    color: var(--sl-color-neutral-900, #111);
  }

  .sheet.fit {
    --rest: 0px;
    height: auto;
    max-height: calc(70vh - var(--mc-safe-top));
  }

  @supports (background: color-mix(in srgb, red 50%, transparent)) {
    .sheet {
      background: color-mix(in srgb, var(--sl-panel-background-color, #fff) 88%, transparent);
    }
  }

  /* No blur means nothing is softening what shows through, so nothing does. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .sheet {
      background: var(--sl-panel-background-color, #fff);
    }
  }

  /* The grab area, not just the bar: a 6px line is not a thumb target, so the
     row around it takes the gesture and the bar only shows where. 44px is
     Apple's own minimum tap target -- at the previous 28px a drag started a
     few pixels low landed on .body instead and scrolled the content rather
     than resizing the sheet. */
  .grip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    margin: 0 -12px;
    cursor: grab;
    touch-action: none;
  }
  .grip:active {
    cursor: grabbing;
  }
  .grip span {
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: var(--mc-text-2, #8a8a8e);
    opacity: 0.4;
  }

  /* A sheet that only closes needs its grip as a sign, not as the target: the
     whole of it takes the pull (see bodyDown), so the row shrinks to the bar
     and hands the rest to the map. */
  .fit .grip {
    height: 18px;
  }
  .fit .grip span {
    width: 32px;
    height: 4px;
  }

  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    /* Momentum scrolling, and a scroll that does not drag the map behind. */
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    /* CellDetails' close button is a 44px glass disc pulled toward the top
       right corner by negative margins, to sit further into the corner than
       a header row half its height would otherwise place it. Without room to
       give, that overhang sat outside the scroll container's own edges and
       was clipped there at rest -- overflow-y:auto implicitly makes
       overflow-x auto too, so the same applies on the right. */
    padding: 10px 8px 0 0;
    /* The scroll range ends at the screen's edge, not at the parked part
       below it, so the last line can still be scrolled into view. */
    padding-bottom: var(--rest);
  }
  /* Nothing in here to scroll -- it is as tall as what it holds -- so a drag
     is the sheet's from the first pixel, rather than the browser's to claim as
     a pan and cancel before the axis is decided. */
  /* And nothing to clip, which lets the close disc overhang into the grip's
     row and sit square in the corner: the sheet's 12px side padding less the
     body's 8px right padding the disc's margin cancels leaves 12px to the
     right; the 1px top border, the 18px grip and this 3px, less the disc's
     10px pull, leave 12px above. Clipped by the body's own top edge, it lost a
     slice off the top at the previous 4px. */
  .fit .body {
    touch-action: none;
    overflow: visible;
    padding-top: 3px;
  }

  .dragging {
    transition: none;
  }
  .settling {
    transition: transform 280ms var(--mc-ease, cubic-bezier(0.32, 0.72, 0, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .settling { transition: none; }
  }
</style>

<div
  class="sheet"
  class:fit={!expandable}
  class:dragging
  class:settling={!dragging}
  bind:this={sheetEl}
  style="--sheet-h: {Math.round(detent * 100)}vh; --drag: {dragY}px"
  transition:fly={slide}>
  <div
    class="grip"
    role="button"
    tabindex="0"
    aria-label="Resize or close details"
    on:pointerdown={grab}
    on:pointermove={move}
    on:pointerup={release}
    on:pointercancel={release}
    on:keydown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") close(); }}>
    <span></span>
  </div>
  <div
    class="body"
    on:pointerdown={bodyDown}
    on:pointermove={bodyMove}
    on:pointerup={bodyUp}
    on:pointercancel={bodyUp}>
    <slot>
      {#if track}<CellDetails {track} />{/if}
    </slot>
  </div>
</div>
