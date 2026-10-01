<script module lang="ts">
/** How the panel leaves: a fly transition's `x`/`y`, in px, and duration. */
export type Leaving = { x?: number; y?: number; duration: number };
</script>

<script lang="ts">
/**
 * A glass panel that swipes aside to show one action under it, the way a
 * notification does on the lock screen.
 *
 * Every bar above the bottom tray -- the rain chart, the dry outlook, the
 * lightning histogram, the coverage notice, the cell hint -- is one of these,
 * so they all answer a thumb the same way: a short pull parks the panel at a
 * detent with the action showing, a long one throws it off the edge, and a
 * touch anywhere else closes the detent again. The hint bar used to leave on
 * any pull with no detent and no action, beside strips that had both; same
 * bar, same gesture, different result, which is the kind of thing a thumb
 * notices before an eye does.
 *
 * This is the mechanism, not the slot on the map: the caller positions and
 * sizes it (the dock fills whatever box it is given), and plays the arrival
 * and the exit, because where it stands and how it leaves differ per bar.
 * What is the same -- the pull, the detent, the resistance past it, the
 * commit, the action's glass and its colour -- is here, once.
 *
 * `dismiss` carries how the panel should leave: on out past the leading edge
 * when it was swiped, so the caller's exit transition continues the gesture.
 */
import { createEventDispatcher } from "svelte";
import { pullTo, swipeAway, SWIPE_COMMIT, SWIPE_DETENT } from "../lib/swipeAway";

/** What the action under the panel says: Hide, Clear. */
export let action: string;
/**
 * Whether a tap on the panel itself -- anywhere but its buttons -- raises
 * `tap`, the way tapping a notification opens what it is about. Off for the
 * charts, whose taps are reading the plot.
 */
export let tappable = false;
/** The stronger glass, for a panel that is mostly text. */
export let strong = false;

const dispatch = createEventDispatcher<{ dismiss: Leaving; tap: void }>();

/** What the action settles to once the swipe has opened it. */
const ACTION_REST = SWIPE_DETENT;

/** How far the panel is currently pulled aside, and how that is animated. */
let reveal = 0;
let committed = false;
let settling = false;
let swiping = false;
let dockWidth = 0;
let startReveal = 0;
/* Set once a press has turned into a swipe, so the click the browser still
   fires at the end of it is not read as a tap. Cleared on the next press. */
let swiped = false;

function onTap(event: MouseEvent) {
  if (!tappable || swiped || reveal > 0) return;
  if ((event.target as Element).closest("button")) return;
  dispatch("tap");
}

/** Animate to a resting position -- 0, the detent, or off the edge. */
function settleTo(px: number) {
  settling = true;
  reveal = px;
  committed = false;
}

function act() {
  /* Straight off the trailing edge first, so the red fills the whole panel
     for the moment before the dock itself leaves. */
  settleTo(dockWidth);
  dispatch("dismiss", { x: -Math.round(dockWidth * 0.3), duration: 220 });
}

function onStart(node: HTMLElement) {
  dockWidth = node.getBoundingClientRect().width || 1;
  startReveal = reveal;
  swiping = true;
  swiped = true;
  settling = false;
}

function onMove(dx: number) {
  // Leftward opens it, rightward pushes it back shut; see `pullTo`.
  reveal = pullTo(startReveal, dx, dockWidth);

  // Crossing the commit point throws the action open the rest of the way in
  // one spring rather than waiting for the finger to drag it there.
  const wasCommitted = committed;
  committed = reveal >= dockWidth * SWIPE_COMMIT;
  if (committed !== wasCommitted) settling = true;
  if (committed) reveal = dockWidth;
}

function onEnd() {
  swiping = false;
  if (committed) {
    act();
    return;
  }
  // Half-open counts as open: the action is the point of the gesture, and
  // snapping shut under a deliberate short pull would just hide it again.
  settleTo(reveal >= ACTION_REST / 2 ? ACTION_REST : 0);
}

/*
 * Parked open is a mode, so something has to take it back out of it: a touch
 * anywhere else closes it, the way it does on the lock screen. Capture phase,
 * so it still fires for a control that stops the event on its way up.
 */
function closeFromOutside(node: HTMLElement) {
  const onOutside = (event: PointerEvent) => {
    if (reveal > 0 && !node.contains(event.target as Node)) settleTo(0);
  };
  window.addEventListener("pointerdown", onOutside, true);
  return { destroy: () => window.removeEventListener("pointerdown", onOutside, true) };
}

/* Clears the swipe flag on the next press, so a tap after a swipe is a tap. */
const onDown = () => { swiped = false; };

/*
 * The click a swipe ends with goes nowhere. A swipe that starts on a control
 * -- the hint's Details button sits in the middle of the bar -- ends with the
 * browser's click on that control, iOS's included whatever has captured the
 * pointer, so the slide opened the details instead. Caught on the way down,
 * before the control's own handler.
 */
function swallowAfterSwipe(event: MouseEvent) {
  if (!swiped) return;
  // One click per swipe: a keyboard press on the button afterwards is meant.
  swiped = false;
  event.preventDefault();
  event.stopPropagation();
}
</script>

<style>
  /* The dock fills its slot and does not move: the panel slides inside it
     and the action is simply what is underneath, so the action needs no
     animation of its own -- its width is whatever the panel has vacated.
     Clipped to the tray radius so the colour follows the same corner. */
  .dock {
    position: absolute;
    inset: 0;
    border-radius: var(--mc-radius-tray);
    overflow: hidden;
    /* The dock owns every gesture that starts on it, the way a notification
       does -- which does mean the map cannot be panned from it. There is no
       splitting it: the dock is a child of <body>, outside the map's
       viewport, so anything it does not take the map never sees at all. */
    pointer-events: auto;
    touch-action: none;                   /* the swipe owns the horizontal drag */
    user-select: none;                    /* a mouse drag must not select the title */
    -webkit-user-select: none;
  }
  .dock.tappable {
    cursor: pointer;
  }

  /* The destructive action, pinned to the trailing edge with the panel on top
     of it. Full height, so what the swipe uncovers reads as one panel rather
     than a button floating in a gap.

     The same glass as everything else, tinted rather than filled: a slab of
     solid red is the one thing on this map that is louder than the weather.
     The red is carried by the label and a wash over the backdrop, and deepens
     at the commit rather than turning opaque. */
  .action {
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
       two. They are only the dock's own corners once the colour has the full
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
  .action.committed {
    background: var(--mc-red-veil-strong);
    color: #fff;
  }
  /* Full width -- on the commit, or on the way out after the action was
     tapped. Keyed off the width rather than off `committed`, because the tap
     takes the same path to full width without ever committing. */
  .action.filled {
    border-radius: var(--mc-radius-tray);
  }
  /* The colour shift runs in both states: a commit happens mid-drag, where the
     width is deliberately not transitioned. Both rules therefore have to spell
     out the whole shorthand -- the specific one replaces it, not adds to it.
     The corners ride along with it, so the leading pair open as the colour
     takes the dock rather than snapping square-to-round on one frame. */
  .action {
    transition: background var(--mc-motion-fast) var(--mc-ease),
                color var(--mc-motion-fast) var(--mc-ease),
                border-radius var(--mc-motion-fast) var(--mc-ease);
  }
  /* Springy on the way to a resting width, immediate while the finger has it:
     the overshoot is what makes the commit read as the button giving way. */
  .dock:not(.swiping) .action {
    transition: width var(--mc-motion-spring) var(--mc-ease-spring),
                background var(--mc-motion-fast) var(--mc-ease),
                color var(--mc-motion-fast) var(--mc-ease),
                border-radius var(--mc-motion-fast) var(--mc-ease);
  }
  .label {
    /* Held at the action's resting width rather than centred in it, so the
       word stays put as the panel stretches past it instead of sliding
       leftwards. */
    position: absolute;
    right: 0;
    width: 96px;
    text-align: center;
    white-space: nowrap;
    transition: opacity 120ms linear, transform 200ms var(--mc-ease);
  }
  .action.committed .label {
    transform: scale(1.08);
  }

  /* The panel itself, in the tray's glass, filling the dock. Its content is
     the caller's, which also decides what in it takes a pointer: the panel
     lets everything through to the dock, so the swipe starts anywhere on it,
     and a control inside opts back in. */
  .panel {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    pointer-events: none;
  }
  /* Only the transform is held back during the drag -- it has to land on the
     frame the finger is on, or the panel trails behind it. The corners are free
     to ease in both states, so both rules spell out the whole shorthand. */
  .panel {
    transition: border-radius var(--mc-motion-spring) var(--mc-ease-spring);
  }
  .panel.settling {
    transition: transform var(--mc-motion-spring) var(--mc-ease-spring),
                border-radius var(--mc-motion-spring) var(--mc-ease-spring);
  }
  /* Squared off against the action for as long as one is open, the way a
     grouped row's trailing corners square up on iOS.

     This is the seam the corner artefact actually came from: the panel's curve
     cuts a wedge out of its own trailing corners, and the action starts at the
     panel's edge, so the wedge is bare map with the action's straight edge
     beside it -- a hard corner against a curve. Neither piece can fill it
     (the panel is 10%-white glass, so an action reaching under it would tint
     the whole edge red), so the curve is the thing to drop. What is left is
     two straight edges meeting, with the dock's own corners carried by the
     action. */
  .dock.open .panel {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
</style>

<div
  class="dock"
  class:open={reveal > 0}
  class:swiping
  class:tappable
  use:swipeAway={{ onStart, onMove, onEnd }}
  use:closeFromOutside
  on:pointerdown={onDown}
  on:click|capture={swallowAfterSwipe}
  on:click={onTap}
  role="presentation">
  <button
    type="button"
    class="action"
    class:committed
    class:filled={dockWidth > 0 && reveal >= dockWidth}
    style:width="{reveal}px"
    tabindex={reveal >= ACTION_REST ? 0 : -1}
    aria-hidden={reveal < ACTION_REST}
    on:click={act}>
    <span class="label" style:opacity={Math.min(1, reveal / 56)}>{action}</span>
  </button>
  <div
    class="panel glass glass-tray"
    class:glass-strong={strong}
    class:settling
    style:transform={reveal ? `translateX(${-reveal}px)` : ""}>
    <slot />
  </div>
</div>
