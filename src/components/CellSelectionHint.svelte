<script lang="ts">
/**
 * The step between tapping a storm and reading about it, on a phone.
 *
 * The first tap draws the cell's forecast on the map and nothing else, which
 * is a state a reader has no way to recognise on its own: marks appeared, and
 * whether that is all there is or whether something more is a tap away is not
 * something a map can say. So this says it, and is the thing to tap -- the
 * hint and the affordance are the same object, because a hint that only tells
 * you to tap somewhere else costs a second reach at the point the reader has
 * already got what they wanted.
 *
 * It names the storm rather than saying "tap again", so the tap that produced
 * it is also acknowledged: the reader learns they hit a strong cell that has
 * been going for half an hour, which for a lot of taps is the whole question.
 */
import { cellDetails, selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { BAND_NAMES, duration } from "../lib/cellMetrics";

export let track: import("../api").CellTrackProperties;

$: severity = Math.min(Math.max(track.max_severity, 0), 3);
$: colour = severityColour(severity);
$: alive = duration((Date.now() - new Date(track.first_seen).getTime()) / 60_000);

/** The one signature worth the width here, in the order the map badges them. */
$: badge = track.meso_ever ? "↻" : (track.hail_ever ? "✦" : "");

const open = () => cellDetails.set(true);

/* The map clears the selection when the background is tapped; this is the same
   thing for a thumb that has the bar under it rather than the map. */
const dismiss = (event: Event) => {
  event.stopPropagation();
  selectedCell.set(null);
};
</script>

<style>
  /* Full width rather than a pill that shrinks to its text. A bar that changes
     width with the name of the storm reads as mangled next to the trays above
     and below it, which are full-width and squared off to the same gutters. */
  .hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(max(var(--bottom-toolbar-height, 0px), var(--mc-safe-bottom)) + 8px);
    z-index: var(--mc-z-pill);
    margin: 0 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 6px 6px 14px;
    border-radius: var(--mc-radius-tray);
    background: var(--mc-glass-fill-strong);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring-lg);
    color: var(--mc-text);
    font: 500 13px/1.3 var(--mc-font);
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
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
  }

  /* Only the band name, or "cell" is capitalised with it. */
  .what .title b {
    font-weight: inherit;
    text-transform: capitalize;
  }

  .what .alive {
    color: var(--mc-text-2);
    font-size: 12px;
    white-space: nowrap;
  }

  .badge {
    font-size: 14px;
    line-height: 1;
    flex: 0 0 auto;
  }

  /* An actual button, filled in the cell's own colour: the previous version
     was a grey chip beside a close button, and the two read as the same kind
     of thing when only one of them was the point. */
  .go {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--colour);
    color: #fff;
    font: 700 13px/1 var(--mc-font);
    letter-spacing: 0.01em;
    cursor: pointer;
  }

  .go .chevron {
    font-size: 15px;
    line-height: 1;
  }

  .close {
    flex: 0 0 auto;
    /* 44px is Apple's minimum for a thumb, and this one sits next to the
       control it must not be hit instead of. */
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mc-text-2);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .go:active {
    transform: scale(var(--mc-press));
  }

  @media (prefers-reduced-motion: reduce) {
    .go:active { transform: none; }
  }
</style>

<div class="hint" style="--colour: {colour}">
  <span class="swatch" style="background: {colour}"></span>
  <span class="what">
    <span class="title"><b>{BAND_NAMES[severity]}</b> cell</span>
    <span class="alive">alive for {alive}</span>
  </span>
  {#if badge}<span class="badge" style="color: {colour}">{badge}</span>{/if}
  <button type="button" class="go" on:click={open}>
    details <span class="chevron" aria-hidden="true">›</span>
  </button>
  <button type="button" class="close" on:click={dismiss} aria-label="Clear selection">&times;</button>
</div>
