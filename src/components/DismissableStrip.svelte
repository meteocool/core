<script lang="ts">
/**
 * A glass strip floating above the bottom tray, cleared the way the lock screen
 * clears a notification.
 *
 * Lifted out of NowcastPlayback when the lightning histogram wanted the same
 * treatment. Everything here is layer-agnostic: the dock and its offsets, the
 * Hide action, the close button and the title row. The swipe itself is
 * SwipeDock's, shared with the cell hint bar, so every bar above the tray
 * answers a pull the same way. What goes in the strip is the caller's,
 * through the slot -- including the plot's own insets, which differ per layer
 * and which the caller's scoped CSS reaches because slot content is compiled
 * in the caller's scope.
 *
 * The caller owns whether the strip exists at all: mount it inside an {#if} and
 * handle `dismiss` by taking it back down. Svelte waits for this component's
 * own outro, so the exit still plays.
 */
import { createEventDispatcher, onDestroy } from "svelte";
import { fly, fade } from "svelte/transition";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import Icon from "./Icon.svelte";
import SwipeDock, { type Leaving } from "./SwipeDock.svelte";
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

/**
 * Whether a tap on the strip itself -- anywhere but its buttons -- raises
 * `tap`, the way tapping a notification opens what it is about. Off for the
 * charts, whose taps are reading the plot.
 */
export let tappable = false;

const dispatch = createEventDispatcher();

/* How the strip leaves: down into the tray when a button sent it there, or on
   out past the leading edge when it was swiped away. */
let out: Leaving = { y: 60, duration: 200 };

function dismiss(leaving: Leaving) {
  out = leaving;
  dispatch("dismiss");
}
</script>

<style>
  /* The strip's slot on the map: a gap above whichever tray is showing, as
     tall as the chart it holds. The dock fills it. */
  .strip-dock {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(
      var(--mc-safe-bottom) + var(--mc-tray-gap) + var(--mc-player-h) + var(--mc-tray-gap)
    );
    height: var(--mc-strip-h);
    z-index: var(--mc-z-chart);
  }

  .strip-dock.collapsed {
    bottom: calc(
      var(--mc-safe-bottom) + var(--mc-tray-gap) + var(--mc-bar-h) + var(--mc-tray-gap)
    );
  }

  /* The panel's content: a title row over the plot, the same width as the
     tray below. */
  .strip {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: 10px 0 4px;
    color: var(--mc-text-2);              /* the axis ink, read off the canvas */
  }

  /* Its own dismissal affordance for anyone who does not swipe -- and nothing
     says a strip can be swiped, so it is there for a thumb too. A touch-sized
     hit area around a small glyph, tucked into the panel's corner radius;
     tighter where there is a cursor to find it with, so it does not crowd the
     title row. */
  .strip-close {
    display: grid;
    place-items: center;
    position: absolute;
    top: -4px;
    right: calc(var(--mc-tray-pad) - 12px);
    width: 44px;
    height: 44px;
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
      top: 2px;
      right: calc(var(--mc-tray-pad) - 4px);
      width: 28px;
      height: 28px;
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
       curve, and of the close button's glyph on the right. Its own inset,
       because the plot's has to stay tied to the track. */
    margin: 0 calc(var(--mc-tray-pad) + 26px) 0 calc(var(--mc-tray-pad) + 8px);
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
  out:fly={{ ...out }}
  in:fade={{ duration: 200 }}>
  <SwipeDock action={$_("hide")} {tappable} on:tap on:dismiss={(e) => dismiss(e.detail)}>
    <div class="strip">
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
  </SwipeDock>
</div>
