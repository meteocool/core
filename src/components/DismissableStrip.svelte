<script lang="ts">
/**
 * A glass strip floating above the bottom tray, cleared the way the lock screen
 * clears a notification.
 *
 * Lifted out of NowcastPlayback when the lightning histogram wanted the same
 * treatment. Everything here is layer-agnostic: the dock and its offsets, the
 * swipe, the Hide action, the close button and the title row. What goes in the
 * strip is the caller's, through the slot -- including the plot's own insets,
 * which differ per layer and which the caller's scoped CSS reaches because slot
 * content is compiled in the caller's scope.
 *
 * The caller owns whether the strip exists at all: mount it inside an {#if} and
 * handle `dismiss` by taking it back down. Svelte waits for this component's
 * own outro, so the exit still plays.
 */
import { createEventDispatcher, onDestroy } from "svelte";
import { decideAxis, SWIPE_COMMIT } from "../lib/swipeAway";
import { fly, fade } from "svelte/transition";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import Icon from "./Icon.svelte";
import { _ } from "svelte-i18n";
import { openStripCount } from "../stores";

/* Counted while mounted, not while merely visible: the outro plays with this
   still in the DOM, so CellSelectionHint keeps clearing it for the strip's
   full exit rather than snapping down before the animation finishes. */
openStripCount.update((n) => n + 1);
onDestroy(() => openStripCount.update((n) => n - 1));

/** The heading. A place name where there is one, else what the strip is. */
export let title: string;

/**
 * An optional action at the trailing end of the title row, and the event it
 * raises. Used by the radar strip to go back to the client's own position;
 * lightning has no equivalent, because a viewport is not somewhere you can
 * return from.
 *
 * `linkIcon` is drawn ahead of the label. Optional, but the radar strip passes
 * one: a bare accent-coloured phrase in a title row reads as a subtitle, and
 * people were not finding it.
 */
export let linkLabel: string | null = null;
export let linkIcon: IconDefinition | null = null;

/** Whether the tray below is the short bar or the full player. */
export let collapsed = true;

const dispatch = createEventDispatcher();

/* The travel that separates a tap from a swipe, and the share of the width
   that commits it, shared with the cell hint bar: see lib/swipeAway.ts. */

/** What the Hide button settles to once the swipe has opened it. */
const ACTION_REST = 96;
/** How much of the finger's travel past the detent the strip actually takes. */
const ACTION_GIVE = 0.7;

/** How far the strip is currently pulled aside, and how that is animated. */
let reveal = 0;
let committed = false;
let settling = false;
let swiping = false;
let dockWidth = 0;

/* How the strip leaves: down into the tray when a button sent it there, or on
   out past the leading edge when it was swiped away. */
let out: { x?: number; y?: number; duration: number } = { y: 60, duration: 200 };

/** Animate to a resting position -- 0, the detent, or off the edge. */
function settleTo(px: number) {
  settling = true;
  reveal = px;
  committed = false;
}

function dismiss(leaving: { x?: number; y?: number; duration: number }) {
  out = leaving;
  dispatch("dismiss");
}

function hide() {
  /* Straight off the trailing edge first, so the red fills the whole strip for
     the moment before the dock itself leaves. */
  settleTo(dockWidth);
  dismiss({ x: -Math.round(dockWidth * 0.3), duration: 220 });
}

/**
 * Swipe-left-to-clear, with a mouse as well as a finger.
 *
 * A press that never moves is left alone entirely, so the close button and
 * anything else inside the strip still gets its click.
 *
 * The axis is decided once, after 6px of travel, and the pointer is captured
 * only if the gesture turned out to be horizontal, so a vertical drag is left
 * alone rather than swallowed half-way through.
 */
function swipeToDismiss(node: HTMLElement) {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let startReveal = 0;
  let axis: "undecided" | "x" | "y" = "undecided";

  function onDown(e: PointerEvent) {
    if (pointer !== null || e.button > 0) return;
    pointer = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startReveal = reveal;
    axis = "undecided";
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (axis === "undecided") {
      // "undecided" is not enough travel yet and "y" is somebody else's
      // gesture; either way this one keeps off.
      axis = decideAxis(mx, my);
      if (axis !== "x") return;
      /* Capture can be refused if the pointer is already gone; the gesture
         still works without it, it just stops tracking outside the dock. */
      try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      dockWidth = node.getBoundingClientRect().width || 1;
      swiping = true;
      settling = false;
    }
    if (axis !== "x") return;

    const pulled = Math.max(0, startReveal - mx);
    // Up to the detent the strip tracks the finger exactly; past it only part
    // of the travel is taken, which is the resistance you feel before it gives.
    reveal = pulled <= ACTION_REST
      ? pulled
      : Math.min(dockWidth, ACTION_REST + (pulled - ACTION_REST) * ACTION_GIVE);

    // Crossing the commit point throws the button open the rest of the way in
    // one spring rather than waiting for the finger to drag it there.
    const wasCommitted = committed;
    committed = reveal >= dockWidth * SWIPE_COMMIT;
    if (committed !== wasCommitted) settling = true;
    if (committed) reveal = dockWidth;
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    try {
      if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    const horizontal = axis === "x";
    axis = "undecided";
    if (!horizontal) return;
    swiping = false;
    if (committed) {
      hide();
      return;
    }
    // Half-open counts as open: the button is the point of the gesture, and
    // snapping shut under a deliberate short pull would just hide it again.
    settleTo(reveal >= ACTION_REST / 2 ? ACTION_REST : 0);
  }

  /* Parked open is a mode, so something has to take it back out of it: a touch
     anywhere else closes it, the way it does on the lock screen. Capture phase,
     so it still fires for a control that stops the event on its way up. */
  function onOutside(e: PointerEvent) {
    if (reveal > 0 && !node.contains(e.target as Node)) settleTo(0);
  }

  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onUp);
  /* Capture can be taken away without a pointerup ever arriving -- a system
     gesture claiming the touch, the node being re-laid-out under it. Without
     this the strip stays parked mid-drag and ignores every later touch. */
  node.addEventListener("lostpointercapture", onUp);
  window.addEventListener("pointerdown", onOutside, true);
  return {
    destroy() {
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.removeEventListener("lostpointercapture", onUp);
      window.removeEventListener("pointerdown", onOutside, true);
    },
  };
}
</script>

<style>
  /* The strip's slot on the map. It does not move: the panel slides inside it
     and the Hide button is simply what is underneath, so the button needs no
     animation of its own -- its width is whatever the panel has vacated.
     Clipped to the tray radius so the red follows the same corner. */
  .strip-dock {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(
      var(--mc-safe-bottom) + var(--mc-tray-gap) + var(--mc-player-h) + var(--mc-tray-gap)
    );
    height: 104px;
    border-radius: var(--mc-radius-tray);
    overflow: hidden;
    z-index: var(--mc-z-chart);
    /* The strip owns every gesture that starts on it, the way a notification
       does -- which does mean the map cannot be panned from these 104px. There
       is no splitting it: the dock is a child of <body>, outside the map's
       viewport, so anything it does not take the map never sees at all. */
    pointer-events: auto;
    touch-action: none;                   /* the swipe owns the horizontal drag */
    user-select: none;                    /* a mouse drag must not select the title */
    -webkit-user-select: none;
  }

  .strip-dock.collapsed {
    bottom: calc(
      var(--mc-safe-bottom) + var(--mc-tray-gap) + var(--mc-bar-h) + var(--mc-tray-gap)
    );
  }

  /* The destructive action, pinned to the trailing edge with the panel on top
     of it. Full height, so what the swipe uncovers reads as one panel rather
     than a button floating in a gap.

     The same glass as everything else, tinted rather than filled: a slab of
     solid red is the one thing on this map that is louder than the weather.
     The red is carried by the label and a wash over the backdrop, and deepens
     at the commit rather than turning opaque. */
  .strip-action {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 0;
    padding: 0;
    border: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    /* The dock clips to the tray radius, but a backdrop-filter escapes an
       ancestor's *rounded* clip in both WebKit and Chromium -- only the square
       border box survives, which is what left a hard corner beside the panel.
       So the button carries the trailing corners itself. The leading pair stay
       square while the panel is still over them: rounding an edge that another
       rounded edge is sitting against opens a lens of bare map between the
       two. They are only the dock's own corners once the red has the full
       width, which is what .filled says. */
    border-radius: 0 var(--mc-radius-tray) var(--mc-radius-tray) 0;
    background: var(--mc-red-veil);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    color: var(--mc-red);
    font: 600 13px/1 var(--mc-font);
    letter-spacing: -0.01em;
    cursor: pointer;
    pointer-events: auto;
  }
  /* Committed: deeper, but still a veil. A solid slab at full width is a
     bigger event than clearing a chart, and the map going quiet behind it is
     the signal -- it does not need to disappear. */
  .strip-action.committed {
    background: var(--mc-red-veil-strong);
    color: #fff;
  }
  /* Full width -- on the commit, or on the way out after the button was tapped.
     Keyed off the width rather than off `committed`, because the tap takes the
     same path to full width without ever committing. */
  .strip-action.filled {
    border-radius: var(--mc-radius-tray);
  }
  /* The colour shift runs in both states: a commit happens mid-drag, where the
     width is deliberately not transitioned. Both rules therefore have to spell
     out the whole shorthand -- the specific one replaces it, not adds to it.
     The corners ride along with it, so the leading pair open as the red takes
     the dock rather than snapping square-to-round on one frame. */
  .strip-action {
    transition: background var(--mc-motion-fast) var(--mc-ease),
                color var(--mc-motion-fast) var(--mc-ease),
                border-radius var(--mc-motion-fast) var(--mc-ease);
  }
  /* Springy on the way to a resting width, immediate while the finger has it:
     the overshoot is what makes the commit read as the button giving way. */
  .strip-dock:not(.swiping) .strip-action {
    transition: width var(--mc-motion-spring) var(--mc-ease-spring),
                background var(--mc-motion-fast) var(--mc-ease),
                color var(--mc-motion-fast) var(--mc-ease),
                border-radius var(--mc-motion-fast) var(--mc-ease);
  }
  .strip-action-label {
    /* Held at the button's resting width rather than centred in it, so the word
       stays put as the panel stretches past it instead of sliding leftwards. */
    position: absolute;
    right: 0;
    width: 96px;
    text-align: center;
    white-space: nowrap;
    transition: opacity 120ms linear, transform 200ms var(--mc-ease);
  }
  .strip-action.committed .strip-action-label {
    transform: scale(1.08);
  }

  /* The panel itself: the same material and width as the tray below, floating a
     gap clear of it rather than bleeding over its edge. */
  .strip {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 10px 0 4px;
    color: var(--mc-text-2);              /* the axis ink, read off the canvas */
    pointer-events: none;
  }
  /* Only the transform is held back during the drag -- it has to land on the
     frame the finger is on, or the panel trails behind it. The corners are free
     to ease in both states, so both rules spell out the whole shorthand. */
  .strip {
    transition: border-radius var(--mc-motion-spring) var(--mc-ease-spring);
  }
  .strip.settling {
    transition: transform var(--mc-motion-spring) var(--mc-ease-spring),
                border-radius var(--mc-motion-spring) var(--mc-ease-spring);
  }
  /* Squared off against the Hide button for as long as one is open, the way a
     grouped row's trailing corners square up on iOS.

     This is the seam the corner artefact actually came from: the panel's curve
     cuts a wedge out of its own trailing corners, and the button starts at the
     panel's edge, so the wedge is bare map with the button's straight edge
     beside it -- a hard corner against a curve. Neither piece can fill it
     (the panel is 10%-white glass, so a button reaching under it would tint
     the whole edge red), so the curve is the thing to drop. What is left is
     two straight edges meeting, with the dock's own corners carried by the
     button. */
  .strip-dock.open .strip {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  /* Its own dismissal affordance for anyone who cannot swipe. Sized as a
     touch-sized hit area around a small glyph, tucked into the panel's corner
     radius, and only mounted where there is a cursor to find it with. */
  .strip-close {
    display: none;
    position: absolute;
    top: 2px;
    right: calc(var(--mc-tray-pad) - 4px);
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: none;
    border-radius: var(--mc-radius-pill);
    color: var(--mc-text-3);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    transition: color var(--mc-motion-fast) var(--mc-ease),
                background var(--mc-motion-fast) var(--mc-ease);
  }
  .strip-close:hover,
  .strip-close:focus-visible {
    color: var(--mc-text);
    background: var(--mc-tint-hover);
  }
  @media (hover: hover) and (pointer: fine) {
    .strip-close {
      display: grid;
      place-items: center;
    }
  }

  .strip-head {
    flex: 0 0 auto;
    display: flex;
    /* Centred, not baseline-aligned: the action is a chip with a box of its
       own, and hanging it off the title's baseline sits it too low. */
    align-items: center;
    gap: 10px;
    /* Clear of the tray's 26px corner, so the text does not start inside the
       curve. Its own inset, because the plot's has to stay tied to the track. */
    margin: 0 calc(var(--mc-tray-pad) + 2px) 0 calc(var(--mc-tray-pad) + 8px);
  }
  /* Room for the close button, which only exists where there is a cursor to
     find it with -- the same query that mounts it. Reserving the 24px
     unconditionally pushed the action a button's width in from an edge that
     had nothing on it, which is what made it look stranded mid-row. */
  @media (hover: hover) and (pointer: fine) {
    .strip-head {
      margin-right: calc(var(--mc-tray-pad) + 26px);
    }
  }

  /* Set the way the system sets a title: primary ink at full weight, in the
     text's own case with the slight negative tracking SF Pro display sizes
     take -- not the small tracked caps of an older grouped-table header. */
  .strip-title {
    /* The one thing that gives way when the row is tight: the link is short,
       fixed, and useless truncated, whereas a clipped place name still reads. */
    flex: 1 1 auto;
    min-width: 0;
    font: 700 13px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The action, set as a tinted chip rather than as bare accent-coloured text.
     Flat text in a title row reads as a subtitle -- especially here, where the
     thing beside it is a place name and "My Location" looks like more of the
     same. The chip gives it an edge, a press state and a hit area, which is
     what says it is a control. */
  .strip-link {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
    font: 600 12px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
    transition: background var(--mc-motion-fast) var(--mc-ease),
                transform var(--mc-motion-fast) var(--mc-ease),
                opacity var(--mc-motion-fast) var(--mc-ease);
  }
  /* Dropped whole where color-mix is not understood, which leaves the resting
     tint -- a chip that does not brighten still works. */
  .strip-link:hover {
    background: color-mix(in srgb, var(--mc-accent) 26%, transparent);
  }
  .strip-link:active {
    opacity: 0.6;
    transform: scale(0.96);
  }
  .strip-link:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  /* Optical: the glyph is drawn on a taller box than the cap height beside it. */
  .strip-link :global(svg) {
    width: 11px;
    height: 11px;
  }

  .strip-body {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>

<div
  class="strip-dock"
  class:collapsed
  class:open={reveal > 0}
  class:swiping
  use:swipeToDismiss
  out:fly={{ ...out }}
  in:fade={{ duration: 200 }}>
  <button
    type="button"
    class="strip-action"
    class:committed
    class:filled={dockWidth > 0 && reveal >= dockWidth}
    style:width="{reveal}px"
    tabindex={reveal >= ACTION_REST ? 0 : -1}
    aria-hidden={reveal < ACTION_REST}
    on:click={hide}>
    <span class="strip-action-label" style:opacity={Math.min(1, reveal / 56)}>
      {$_("hide")}
    </span>
  </button>
  <div
    class="strip glass glass-tray"
    class:settling
    style:transform={reveal ? `translateX(${-reveal}px)` : ""}>
    <div class="strip-head">
      <span class="strip-title">{title}</span>
      {#if linkLabel}
        <button type="button" class="strip-link" on:click={() => dispatch("link")}>
          {#if linkIcon}<Icon icon={linkIcon} />{/if}
          <span>{linkLabel}</span>
        </button>
      {/if}
    </div>
    <button
      type="button"
      class="strip-close"
      title={$_("close")}
      aria-label={$_("close")}
      on:click={() => dismiss({ y: 60, duration: 200 })}>
      <Icon icon={faXmark} />
    </button>
    <div class="strip-body">
      <slot />
    </div>
  </div>
</div>
