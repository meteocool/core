<script lang="ts">
/**
 * The step between tapping a storm and reading about it, on a phone.
 *
 * The first tap draws the cell's forecast on the map and nothing else, which
 * is a state a reader has no way to recognise on its own: marks appeared, and
 * whether that is all there is or whether something more is a tap away is not
 * something a map can say. So this says it, and is the thing to tap: the
 * hint and the affordance are the same object, because a hint that only tells
 * you to tap somewhere else costs a second reach at the point the reader has
 * already got what they wanted. The whole bar opens the details, as tapping
 * a notification opens what it is about; the chip only says so.
 *
 * It names the storm rather than saying "tap again", so the tap that produced
 * it is also acknowledged: the reader learns they hit a strong cell that has
 * been going for half an hour, which for a lot of taps is the whole question.
 *
 * One of the bars above the tray, in the same dock as the chart strips
 * (SwipeDock): it fades in, swipes aside to a Clear action, and leaves the
 * way they do.
 */
import { fly, fade } from "svelte/transition";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { _ } from "svelte-i18n";
import Icon from "./Icon.svelte";
import SwipeDock, { type Leaving } from "./SwipeDock.svelte";
import { cellDetails, openStripCount, selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { BAND_NAMES, duration } from "../lib/cellMetrics";

export let track: import("../api").CellTrackProperties;

$: severity = Math.min(Math.max(track.max_severity, 0), 3);
$: colour = severityColour(severity);
/* A cell the backend no longer calls active has stopped, and says so: a
   severity-coloured dot and an "alive for" counting on to now would read as a
   storm still going. Its lifetime is its detections' span, plus the one scan
   the last of them stands for, so a single detection is not "0 min". */
$: ended = !track.active;
$: lived = duration(
  ended
    ? (new Date(track.last_seen).getTime() - new Date(track.first_seen).getTime()) / 60_000 + 5
    : (Date.now() - new Date(track.first_seen).getTime()) / 60_000,
  $_,
);
$: lifeLine = !ended
  ? $_("storm.hint.alive", { values: { duration: lived } })
  : $_((track.child_codes?.length ?? 0) > 0 ? "storm.hint.superseded" : "storm.hint.ended", {
    values: { duration: lived },
  });

const open = () => cellDetails.set(true);

/* How the bar leaves: down into the tray when its button sent it there, or
   on out past the leading edge when it was swiped away. */
let out: Leaving = { y: 60, duration: 200 };

/* The map clears the selection when the background is tapped; this is the same
   thing for a thumb that has the bar under it rather than the map. */
function clear(leaving: Leaving) {
  out = leaving;
  selectedCell.set(null);
}
</script>

<style>
  /* The bar's slot on the map: full width rather than a pill that shrinks to
     its text. A bar that changes width with the name of the storm reads as
     mangled next to the trays above and below it, which are full-width and
     squared off to the same gutters.

     Stacked above whichever strips are up (a strip's dock is a fixed height
     plus the tray gap it floats above), so clearing a strip below reads as
     this bar settling down into its place, the way a cleared notification
     lets the ones above it drop, rather than an abrupt jump once the strip's
     own exit finishes. */
  .hint-dock {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(
      max(var(--bottom-toolbar-height, 0px), var(--mc-safe-bottom))
      + var(--mc-tray-gap)
      + var(--open-strips, 0) * (var(--mc-strip-h) + var(--mc-tray-gap))
    );
    height: var(--mc-hint-h);
    transition: bottom var(--mc-motion-spring) var(--mc-ease-spring);
    z-index: var(--mc-z-pill);
  }

  .hint {
    height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 2px 0 14px;
    color: var(--mc-text);
    font: 500 13px/1.3 var(--mc-font);
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .swatch.ended {
    background: var(--mc-text-3);
  }

  /* Two lines rather than one that wraps. "Strong cell (alive for 49 min)" is
     about thirty characters and there are two controls and a swatch beside it;
     at 375px that reflows mid-parenthesis and the bar grows a ragged second
     line. Stacked, it is the same sentence and always fits. */
  .what {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .what .title {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Heading style: both the band name and "Cell" capitalise. Capitalize on
       the <b> alone would leave "cell" lowercase. */
    text-transform: capitalize;
  }

  .what .title b {
    font-weight: inherit;
  }

  .what .alive {
    color: var(--mc-text-2);
    font-size: 12px;
    white-space: nowrap;
  }

  /* Tinted, not filled.
     A solid fill in the cell's own severity colour is the loudest thing in the
     bar and competes with the map behind it; on a red cell it reads as a
     warning instead of a way in. A wash of the same hue behind coloured text
     keeps it obviously a control without it shouting. The chevron does most
     of the work. */
  .go {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 10px 0 12px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: color-mix(in srgb, var(--colour) 14%, transparent);
    color: var(--colour);
    font: 600 13px/1 var(--mc-font);
    letter-spacing: 0;
    cursor: pointer;
    pointer-events: auto;
  }

  /* Where color-mix is missing the tint would fall back to nothing, leaving
     bare coloured text; a neutral wash keeps the shape. */
  @supports not (background: color-mix(in srgb, red 50%, transparent)) {
    .go { background: var(--mc-glass-fill); }
  }

  /* Thin and a little smaller than the label, the way a disclosure chevron is
     drawn rather than the way a text angle bracket lands. */
  .go .chevron {
    font-size: 16px;
    line-height: 1;
    opacity: 0.75;
    margin-top: -1px;
  }

  /* The strips' close button: a touch-sized hit area around a small glyph.
     44px is Apple's minimum for a thumb, and this one sits next to the
     control it must not be hit instead of. */
  .close {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: none;
    color: var(--mc-text-3);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
    transition: color var(--mc-motion-fast) var(--mc-ease),
                background var(--mc-motion-fast) var(--mc-ease);
  }
  .close:hover,
  .close:focus-visible {
    color: var(--mc-text);
    background: var(--mc-tint-hover);
  }

  .go:active {
    transform: scale(var(--mc-press));
  }

  @media (prefers-reduced-motion: reduce) {
    .go:active { transform: none; }
    .hint-dock { transition: none; }
  }
</style>

<div
  class="hint-dock"
  style="--colour: {colour}; --open-strips: {$openStripCount}"
  out:fly={{ ...out }}
  in:fade={{ duration: 200 }}>
  <SwipeDock action={$_("storm.hint.clear_action")} tappable strong on:tap={open} on:dismiss={(e) => clear(e.detail)}>
    <div class="hint">
      <span class="swatch" class:ended style:background={ended ? null : colour}></span>
      <span class="what">
        <span class="title">
          <b>{$_(`storm.hint.band.${BAND_NAMES[severity]}`)}</b> {$_("storm.hint.cell")}
        </span>
        <span class="alive">{lifeLine}</span>
      </span>
      <button type="button" class="go" on:click={open}>
        {$_("storm.hint.details")} <span class="chevron" aria-hidden="true">›</span>
      </button>
      <button
        type="button"
        class="close"
        aria-label={$_("storm.hint.clear")}
        title={$_("storm.hint.clear")}
        on:click={() => clear({ y: 60, duration: 200 })}>
        <Icon icon={faXmark} />
      </button>
    </div>
  </SwipeDock>
</div>
