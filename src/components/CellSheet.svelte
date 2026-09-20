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
import { cellDetails } from "../stores";
import { afterClose } from "../lib/cellSelection";
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

/* ---- pull down to dismiss ---------------------------------------------- */

/**
 * The grabber is draggable, not decorative.
 *
 * A sheet with a handle that does not move is a worse lie than no handle: the
 * shape promises the gesture, and a reader who tries it and gets nothing
 * learns the UI is fake rather than that they were wrong. So the drag is real,
 * and it follows the finger.
 */
let dragY = 0;
let dragging = false;
let startY = 0;

/** Far enough that the pull was meant, short enough to be one easy motion. */
const DISMISS_PX = 90;

function grab(event: PointerEvent) {
  dragging = true;
  startY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (!dragging) return;
  // Downward only: dragging a docked sheet upward would lift it off the edge
  // it is docked to, and there is nothing under it to reveal.
  dragY = Math.max(0, event.clientY - startY);
}

function release() {
  if (!dragging) return;
  dragging = false;
  if (dragY > DISMISS_PX) close();
  dragY = 0;
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
    /* Short enough that the storm the sheet describes is still on the map
       above it, which is the whole reason it is docked rather than full. */
    max-height: 82vh;
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
     row around it takes the gesture and the bar only shows where. */
  .grip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
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
  }

  .dragging {
    transition: none;
  }
  .settling {
    transition: transform 200ms var(--mc-ease, cubic-bezier(0.32, 0.72, 0, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .settling { transition: none; }
  }
</style>

<div
  class="sheet"
  class:dragging
  class:settling={!dragging}
  style="transform: translateY({dragY}px)"
  transition:fly={slide}>
  <div
    class="grip"
    role="button"
    tabindex="0"
    aria-label="Close details"
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
