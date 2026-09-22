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
import { cellDetails } from "../stores";
import { afterClose } from "../lib/cellSelection";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import CellDetails from "./CellDetails.svelte";

export let track: import("../api").CellTrackProperties;

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
  cellDetails.set(afterClose({ code: track.code, details: true }, true).details);
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
const HALF = 0.4;
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

/** Far enough that the drag was meant, short enough to be one easy motion. */
const SNAP_PX = 60;

function grab(event: PointerEvent) {
  dragging = true;
  startY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (!dragging) return;
  const delta = event.clientY - startY;
  // Upward only as far as the full detent is from here, so the sheet cannot be
  // dragged off the top of the screen and left there.
  const headroom = detent === HALF ? -(FULL - HALF) * window.innerHeight : 0;
  dragY = Math.max(headroom, delta);
}

function release() {
  if (!dragging) return;
  dragging = false;
  const moved = dragY;
  dragY = 0;
  if (moved < -SNAP_PX) {
    detent = FULL;
  } else if (moved > SNAP_PX) {
    // Down from full lands on half; down from half lets go of the cell.
    if (detent === FULL) detent = HALF;
    else close();
  }
}

</script>

<style>
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1200;
    display: flex;
    flex-direction: column;
    /* Set from the detent, so the map above always has the rest -- except at
       FULL, where the detent alone is not trusted: env(safe-area-inset-top)
       is the one number that actually knows the status bar / dynamic island
       height on this device, so the real cap is measured from that rather
       than a vh guess that put the grip behind it on some phones. */
    height: min(var(--sheet-h), calc(100vh - var(--mc-safe-top) - 28px));
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
  }

  .dragging {
    transition: none;
  }
  .settling {
    transition:
      transform 200ms var(--mc-ease, cubic-bezier(0.32, 0.72, 0, 1)),
      height 260ms var(--mc-ease, cubic-bezier(0.32, 0.72, 0, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .settling { transition: none; }
  }
</style>

<div
  class="sheet"
  class:dragging
  class:settling={!dragging}
  style="--sheet-h: {Math.round(detent * 100)}vh; transform: translateY({dragY}px)"
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
  <div class="body">
    <CellDetails {track} />
  </div>
</div>
