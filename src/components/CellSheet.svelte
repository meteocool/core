<script module lang="ts">
/**
 * How many sheets are up. The bottom toolbar and the collapsed player's discs
 * hide while any are: see `body.cell-details-open` in App.svelte. Counted
 * here rather than derived from the stores in App.svelte, so every sheet
 * (a storm's, the model comparison's, a reading panel's) hides them the
 * same way, and they come back after the last one's outro rather than under
 * it.
 */
let openSheets = 0;
</script>

<script lang="ts">
/**
 * The detail panel as a sheet, on a phone.
 *
 * A card floating in the corner is a desktop idea: it assumes a map big enough
 * that something can sit on top of it without being in the way. On a phone
 * there is no such corner, so the panel comes up from the bottom edge instead:
 * anchored to the thumb, over a map that stays visible above it, dismissed by
 * pulling it back down. Phone UIs use that shape for this, so a reader already
 * knows what to do with a sheet without being told.
 *
 * Glass rather than the desktop panel's solid fill, so the map keeps showing
 * through the edges and the sheet reads as floating over it rather than as a
 * second screen that replaced it.
 *
 * The one surface a phone has for anything that opens over the map: the
 * storm panels take it through App.svelte, and the reading panels (About,
 * Settings, Connection Details) through GlassPanel, in the reading
 * material and opened at full height, since they are read rather than
 * navigated with.
 */
import { fly } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";
import { cellDetails, sharedActiveCap } from "../stores";
import { afterClose } from "../lib/cellSelection";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { holdNativeChrome, postToNative } from "../lib/nativeBridge";
import { decideAxis, type SwipeAxis } from "../lib/swipeAway";
import { provideSheet } from "../lib/sheetContext";
import CellDetails from "./CellDetails.svelte";
import CloseDisc from "./CloseDisc.svelte";
import ShareDisc from "./ShareDisc.svelte";

/**
 * The cell whose details fill the sheet, or none when something else is
 * given as its content: a storm core on the 3D map takes the same sheet, so a
 * phone has one surface for "the storm you tapped", whatever kind it is.
 */
export let track: import("../api").CellTrackProperties | null = null;
/** What dismissing the sheet does, when it is not a cell's details closing. */
export let onClose: (() => void) | null = null;
/**
 * Whether it pulls up to full height. Not for content that already fits at
 * rest; a sheet that does not pull up is as tall as what it holds, so a few
 * facts and a dial are neither clipped nor floating in a half-empty panel.
 */
export let expandable = true;
/**
 * As tall as what it holds at rest, and pulled up to full height for more.
 *
 * For content whose resting form is short and whose long form is reading
 * nobody needs every time: a storm on the 3D map is a few facts and the
 * dial, and how its volume was built comes only when asked for. The slot is
 * told which it is showing, and is handed a way to pull the sheet up itself,
 * because a grabber alone does not say there is anything above it.
 */
export let fitAtRest = false;
/**
 * Opens at full height rather than half. For reading: a page of settings or
 * diagnostics has nothing on the map to keep in view, and at half height is a
 * column of text in a strip. Pulling it down still lands on half before it
 * closes, unless `halfway` says otherwise.
 */
export let full = false;
/**
 * Whether the sheet has a half-height stop at all. Not for a page that is read
 * rather than navigated with (About, Settings, Connection Details): a third
 * of a page of prose over a strip of map is neither, so pulling one down
 * closes it rather than parking it half open.
 */
export let halfway = true;
/**
 * The glass it is made of. The drawer's by default (see src/glass.css): the
 * storm panels' material, which keeps some of the map's colour. "reading"
 * for a wall of text, which takes the reading material instead: the same
 * glass the floating panel uses on a desktop, so a panel reads the same on
 * both.
 */
export let material: "drawer" | "reading" = "drawer";
/**
 * The id of the title that names the sheet, for a sheet that is a modal
 * dialog (the reading panels). On the sheet itself rather than on the panel
 * inside it, so the close disc, which is the sheet's, is inside the dialog: a
 * modal tells a screen reader that everything outside it is out of reach.
 */
export let dialogLabelledBy: string | null = null;

// The panel inside leaves its own close and share discs out; see lib/sheetContext.ts.
const share = provideSheet();

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
 * At one height the sheet has to pick between being readable and leaving the
 * map visible, and readable (82% of the screen, with the family graph below
 * the fold) is the wrong trade for the graph in particular. The graph is a
 * thing you navigate *with*: tapping a node moves the selection on the map,
 * and if the map is a strip at the top there is nothing to see it move on.
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
 * Laid out sideways the chart is about 170 tall, and the section around it
 * (heading, chart, the recency line under it) comes to roughly 300 including
 * the grabber and the sheet's own padding. 40% of a 812pt phone is 325, which holds that with
 * a little over, and hands the other 60% back to the map.
 */
/*
 * Shorter on the 3D map, where the storm the reader opened stands on the map
 * itself, cut open, and the sheet's job is the readings and the dial that
 * turns the cut, neither of which needs the family chart's room. A third of
 * the screen holds the header, the dial and the first readings, and leaves
 * the storm the rest. Read once: a sheet lives for one selection, and the map
 * does not change under an open one.
 */
const HALF = get(sharedActiveCap) === "cells3d" ? 0.32 : 0.4;
// Short of the full screen on purpose: a strip of map stays visible above the
// sheet so it reads as a drawer sitting over the map rather than a second
// screen, and there is something to see the grip is still draggable toward.
// A bare vh fraction cannot know how tall the status bar or a dynamic island
// is, and that varies by device, so this is deliberately higher than the
// sheet is ever meant to render at. The .sheet CSS clamps the real height
// against --mc-safe-top instead, which keeps the grip clear of that chrome on
// every phone and not only on the one this was tuned on.
const FULL = 0.95;

let detent = full ? FULL : HALF;

/**
 * At FULL the sheet covers the native buttons floating on top of the
 * webview (layer switcher, settings, location, logo). CSS can hide the
 * web toolbar underneath but has no reach into that native layer, so the
 * host app is told directly. Tapping a different cell can drop straight
 * from FULL to unmounted (nextSelection closes the panel instead of
 * stepping it down to HALF first), so `onDestroy` re-shows the buttons
 * unconditionally rather than trusting the last detent seen.
 */
let sheetExpandedNative = false;

function syncNativeChrome(expanded: boolean) {
  if (!dd.isApp() || expanded === sheetExpandedNative) return;
  sheetExpandedNative = expanded;
  postToNative(expanded ? "detailSheetExpanded" : "detailSheetCollapsed");
}

$: syncNativeChrome(detent === FULL);

onDestroy(() => syncNativeChrome(false));

// From the first frame, before whatever the sheet holds has loaded.
onMount(holdNativeChrome);

onMount(() => {
  openSheets += 1;
  document.body.classList.add("cell-details-open");
  return () => {
    openSheets -= 1;
    if (openSheets === 0) document.body.classList.remove("cell-details-open");
  };
});

/* ---- drag the grabber --------------------------------------------------- */

/**
 * The grabber is draggable, not decorative.
 *
 * A sheet with a handle that does not move is a worse lie than no handle: the
 * shape promises the gesture, and a reader who tries it and gets nothing
 * learns the UI is fake rather than that they were wrong. So the drag is real,
 * and it follows the finger, upward as well, because there is somewhere above
 * to go.
 */
let dragY = 0;
let dragging = false;
let startY = 0;
let sheetEl: HTMLElement;
/** How far below the screen's edge the sheet's lower part sits, at rest. */
let restPx = 0;
/**
 * A sheet fitted to its content has no lower part parked below the edge to
 * slide in (it is only as tall as what it holds), so pulling one up grows
 * it from its resting height instead, and this is that height.
 */
let fitPx = 0;

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
  fitPx = sheetEl.getBoundingClientRect().height;
}

/** Whether this drag is growing a fitted sheet toward full height, rather than sliding it. */
$: growing = fitAtRest && expandable && detent === HALF && dragY < 0;
$: growStyle = growing ? `; height: ${Math.round(fitPx - dragY)}px; max-height: none` : "";

function grab(event: PointerEvent) {
  startDrag(event.clientY);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (!dragging) return;
  const delta = event.clientY - startY;
  // Upward only as far as the full detent is from here, so the sheet cannot be
  // dragged off the top of the screen and left there.
  // A fitted sheet grows up to the full detent's height (the CSS clamp on
  // `--full-h`, near enough), which only bounds the drag.
  const fullPx = Math.min(FULL * window.innerHeight, window.innerHeight - 60);
  const reach = fitAtRest ? Math.max(0, fullPx - fitPx) : restPx;
  const headroom = detent === HALF && expandable ? -reach : 0;
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
    if (detent === FULL && halfway) detent = HALF;
    else close();
  }
}

/* ---- drag the body, when it has nothing of its own to scroll ------------ */

/**
 * A grip 44px tall is still a small target on a panel most of which is this.
 * When the content fits without scrolling there is nothing for a vertical
 * drag here to do *but* move the sheet, so it gets to, with the same detent
 * snapping as the grip, from wherever the thumb lands.
 *
 * Two things stay out of that: a drag that turns out to be a tap on a control
 * in here (the close button, a link), and the 3D model, which already owns
 * its own vertical drag to turn the shape and would never get it back once a
 * few pixels of "is this a resize" slop ran out first. The cut's dial is not
 * one of them: it turns sideways only and lets a vertical drag go uncaptured,
 * deciding with the same rule as below, so the sheet takes it from there.
 *
 * The axis decision is the same slop-then-commit rule swipeAway.ts uses for
 * the strips' swipe-to-clear, which tells a tap from a gesture. Without it, a
 * plain tap on anything in the body would start a drag before the tap
 * underneath it ever got the event.
 */
/**
 * Whether the body has been scrolled off its top. At rest the header sits
 * just under the grip's strip and the fade above it is short, so the close
 * disc is not faded with it; once reading has scrolled up under the bar, the
 * fade grows to cover the whole strip, or the text runs under the bar.
 */
let scrolled = false;

/* ---- the scroll indicator ----------------------------------------------- */

/**
 * The sheet's own scroll indicator, in place of the platform's.
 *
 * The platform draws its indicator down the scroller's whole right edge, and
 * the scroller starts at the sheet's top, so on a phone it runs from under
 * the grip, behind the close disc in the corner, which nothing in CSS moves.
 * This one keeps to a track from below the disc to the screen's edge (the
 * sheet's lower part is parked off it; see --rest), shows while the body
 * scrolls and fades out after, as the platform's does.
 */
/** Where the track starts: the corner disc's 11px, its 44px, and a gap. */
const INDICATOR_TOP = 63;
/** Clear of the screen's bottom edge, and of the home indicator's curve. */
const INDICATOR_BOTTOM_GAP = 10;
const INDICATOR_MIN_THUMB = 36;
const INDICATOR_LINGER_MS = 900;

let indicatorShown = false;
let thumbTop = 0;
let thumbHeight = 0;
let indicatorTimer: ReturnType<typeof setTimeout> | null = null;

function showIndicator(el: HTMLElement) {
  // A closing sheet's body still scrolls as its content goes, after the sheet
  // itself is unbound.
  if (!sheetEl) return;
  const range = el.scrollHeight - el.clientHeight;
  const sheetTop = sheetEl.getBoundingClientRect().top;
  const body = el.getBoundingClientRect();
  const visibleBottom = Math.min(body.bottom, window.innerHeight);
  const track = visibleBottom - sheetTop - INDICATOR_BOTTOM_GAP - INDICATOR_TOP;
  if (range <= 0 || track <= INDICATOR_MIN_THUMB) {
    indicatorShown = false;
    return;
  }
  // What is on screen of the body, against all there is to scroll through.
  const onScreen = visibleBottom - body.top;
  thumbHeight = Math.max(INDICATOR_MIN_THUMB, (track * onScreen) / (onScreen + range));
  thumbTop = INDICATOR_TOP + (track - thumbHeight) * Math.min(1, Math.max(0, el.scrollTop / range));
  indicatorShown = true;
  if (indicatorTimer !== null) clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => { indicatorShown = false; }, INDICATOR_LINGER_MS);
}

onDestroy(() => { if (indicatorTimer !== null) clearTimeout(indicatorTimer); });

let bodyPointer: number | null = null;
let bodyStartX = 0;
let bodyStartY = 0;
let bodyAxis: SwipeAxis = "undecided";
let bodyEligible = false;

function bodyDown(event: PointerEvent) {
  if (event.button > 0) return;
  // The models own their drags, the CAPPI's height included; see above.
  if ((event.target as HTMLElement).closest(".model, .cappi")) return;
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
    /* Set from the detent, so the map above always has the rest, except at
       FULL, where the detent alone is not trusted: env(safe-area-inset-top)
       is the one number that knows the status bar / dynamic island height on
       this device, so the real cap is measured from that instead of a vh
       guess that can put the grip behind it. The 60px past that clears the
       status bar with room to spare; 28px reads as "no map visible", since it
       barely clears the chrome. */
    --full-h: min(95vh, calc(100vh - var(--mc-safe-top) - 60px));
    height: var(--full-h);
    /* Always that tall, and slid down by however much the detent leaves off,
       so the part below the fold is laid out and waiting under the screen's
       edge. Sized to the detent instead, pulling it up would drag a half-height
       panel into the air with bare map underneath until the finger let go. */
    --rest: max(0px, calc(var(--full-h) - var(--sheet-h)));
    transform: translateY(calc(var(--rest) + var(--drag, 0px)));
    /* The drawer's own inset, as the place cards keep theirs: the text sits
       well in from the glass's edge rather than against it. */
    padding: 0 var(--mc-drawer-pad) calc(12px + var(--mc-safe-bottom));
    border-radius: 28px 28px 0 0;
    /* The tray tokens are built for a pill with three words on it. This is two
       charts, a 3D model and thirty numbers, over a radar composite running
       green to magenta: at --mc-glass-fill-strong the colours come through and
       the text sits in a rainbow. So the sheet is the drawer material (see
       src/glass.css), which blurs the map to washes of colour and tone-maps it
       away from the ink, and which flips light and dark with the rest of the
       UI, as the tray tokens do not. The class supplies the fill, the blur,
       the shadow and the ink. */
    border-top: 1px solid var(--mc-drawer-edge);
  }

  /* The reading material, over the drawer's shape and shadow: the fill, the
     blur and the ink are the floating panel's (.glass-reading). */
  .sheet.reading {
    --mc-text-2: var(--mc-reading-text-2);
    --mc-text-3: var(--mc-reading-text-3);
    background: var(--mc-reading-fill);
    -webkit-backdrop-filter: var(--mc-reading-backdrop);
    backdrop-filter: var(--mc-reading-backdrop);
  }

  .sheet.fit {
    --rest: 0px;
    height: auto;
    max-height: calc(70vh - var(--mc-safe-top));
  }

  /* The grab area, not just the bar: a 6px line is not a thumb target, so the
     row around it takes the gesture and the bar only shows where. 44px is
     Apple's own minimum tap target; at 28px a drag started a few pixels low
     lands on .body instead and scrolls the content rather than resizing the
     sheet. */
  .grip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    margin: 0 calc(-1 * var(--mc-drawer-pad));
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
    background: var(--mc-text-3);
    opacity: 0.7;
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

  /*
   * The sheet that expands keeps its 44px of grip, but laid over the top of
   * the body rather than stacked above it, so the header (and the close disc
   * in it) can come up to where the 3D sheet has them: the disc 12px from the
   * top and 12px from the right, the title level with it, the bar in the strip
   * above. Stacked, the disc would hang 45px down under a 12px right margin.
   *
   * Held clear of the disc's column on both sides (12 + 44 + 12), so the disc
   * stays the thing a tap in the corner reaches and the bar stays centred.
   */
  .sheet:not(.fit) .grip {
    position: absolute;
    top: 0;
    left: 68px;
    right: 68px;
    z-index: 1;
    margin: 0;
    align-items: flex-start;
    padding-top: 6px;
    box-sizing: border-box;
  }
  /* 21px, so the disc's 10px pull lands it 12px below the sheet's outer edge
     past the 1px top border, and the header on the line the 3D sheet's is.
     What scrolls up past that fades out in the strip the bar stands in, rather
     than running under it.

     And out at the bottom, over the last stretch before the screen's edge,
     so the reading runs off into the glass rather than being guillotined by
     it. That edge is not the body's: the sheet is laid out full height and
     parked with its lower part below the screen (see --rest), so the fade
     ends that far up from the body's own bottom, less the sheet's padding,
     and follows a drag, which moves the edge. The scroll range is padded by
     the fade's length, so the last line still scrolls clear of it. */
  .sheet:not(.fit) .body {
    --fade-top: 11px;
    --fade-end: max(0px, calc(var(--rest) + var(--drag, 0px) - 12px - var(--mc-safe-bottom)));
    padding-top: 21px;
    padding-bottom: calc(var(--rest) + var(--mc-fade-bottom));
    -webkit-mask-image: linear-gradient(to bottom,
      transparent, #000 var(--fade-top),
      #000 calc(100% - var(--fade-end) - var(--mc-fade-bottom)),
      transparent calc(100% - var(--fade-end)));
    mask-image: linear-gradient(to bottom,
      transparent, #000 var(--fade-top),
      #000 calc(100% - var(--fade-end) - var(--mc-fade-bottom)),
      transparent calc(100% - var(--fade-end)));
  }
  .sheet:not(.fit) .body.scrolled {
    --fade-top: 40px;
  }

  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    /* The platform's indicator runs behind the close disc; the sheet draws its
       own (.indicator). */
    scrollbar-width: none;
    /* Momentum scrolling, and a scroll that does not drag the map behind. */
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    /* 8px in on the right, past the sheet's own 12: what is written here
       ends 20px from the sheet's edge. */
    padding: 10px 8px 0 0;
    /* How far a panel's header keeps in from the right for the sheet's own
       close disc in the corner (.corner): the disc's 44px and its 12px from
       the edge, plus the 10px a header leaves before it, less the 20px this
       body is in already. Read by StormPanel and GlassPanel. */
    --mc-sheet-corner: 46px;
    /* The scroll range ends at the screen's edge, not at the parked part
       below it, so the last line can still be scrolled into view. */
    padding-bottom: var(--rest);
  }
  /* And the share disc beside it, when the panel has one: another 44px and
     the corner's 8px gap. */
  .body.shares {
    --mc-sheet-corner: 98px;
  }
  /* Nothing in here to scroll (it is as tall as what it holds), so a drag
     is the sheet's from the first pixel, rather than the browser's to claim as
     a pan and cancel before the axis is decided. */
  /* And nothing to clip. The 1px top border, the 18px grip and this 3px put
     a panel's header level with the corner's close disc, 12px down. */
  .fit .body {
    touch-action: none;
    overflow: visible;
    padding-top: 3px;
  }

  .body::-webkit-scrollbar {
    display: none;
  }

  .indicator {
    position: absolute;
    top: 0;
    right: 3px;
    z-index: 2;
    width: 3px;
    height: var(--thumb-h);
    border-radius: 2px;
    background: var(--mc-text-3);
    transform: translateY(var(--thumb-top));
    opacity: 0;
    transition: opacity 260ms ease;
    pointer-events: none;
  }
  .indicator.shown {
    opacity: 0.6;
    transition-duration: 80ms;
  }

  /* The way out, in the corner and out of the body, so it stays where it is
     while the reading scrolls under it, and clear of the fade the body's top
     edge takes. The same place it held in a panel's header at rest: 12px in
     from the right and 12px below the outer edge, past the 1px top border.
     Over the grip, which keeps clear of this column on both sides. */
  .corner {
    position: absolute;
    top: 11px;
    right: 12px;
    z-index: 2;
    display: flex;
    gap: 8px;
  }
  /* The disc's own margins pull it into a header's corner; here it is placed. */
  .corner :global(button),
  .corner :global(button.edge) {
    margin: 0;
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
  class="sheet mc-drawer"
  role={dialogLabelledBy ? "dialog" : undefined}
  aria-modal={dialogLabelledBy ? "true" : undefined}
  aria-labelledby={dialogLabelledBy}
  class:reading={material === "reading"}
  class:fit={!expandable || (fitAtRest && detent === HALF)}
  class:dragging
  class:settling={!dragging}
  bind:this={sheetEl}
  style="--sheet-h: {Math.round(detent * 100)}vh; --drag: {growing ? 0 : dragY}px{growStyle}"
  transition:fly={slide}>
  <div
    class="grip"
    role="button"
    tabindex="0"
    aria-label={$_("storm.sheet.grip")}
    on:pointerdown={grab}
    on:pointermove={move}
    on:pointerup={release}
    on:pointercancel={release}
    on:keydown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") close(); }}>
    <span></span>
  </div>
  <div
    class="body"
    class:scrolled
    class:shares={$share !== null}
    on:scroll={(e) => { scrolled = e.currentTarget.scrollTop > 0; showIndicator(e.currentTarget); }}
    on:pointerdown={bodyDown}
    on:pointermove={bodyMove}
    on:pointerup={bodyUp}
    on:pointercancel={bodyUp}>
    <slot expanded={detent === FULL} expand={() => { if (expandable) detent = FULL; }}>
      {#if track}<CellDetails {track} />{/if}
    </slot>
  </div>
  <div
    class="indicator"
    class:shown={indicatorShown}
    style="--thumb-top: {thumbTop}px; --thumb-h: {thumbHeight}px"
    aria-hidden="true"></div>
  <div class="corner">
    {#if $share}<ShareDisc onShare={$share} material={material === "reading" ? "chrome" : "drawer"} />{/if}
    <CloseDisc material={material === "reading" ? "chrome" : "drawer"} on:click={close} />
  </div>
</div>
