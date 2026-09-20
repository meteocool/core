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
 * it is also acknowledged: the reader learns they hit a strong cell with hail,
 * which for a lot of taps is the whole question.
 */
import { cellDetails, selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { BAND_NAMES } from "../lib/cellMetrics";

export let track: import("../api").CellTrackProperties;

$: severity = Math.min(Math.max(track.max_severity, 0), 3);
$: colour = severityColour(severity);

/** The one signature worth the width here, in the order the map badges them. */
$: badge = track.meso_ever ? "↻" : (track.hail_ever ? "✦" : "");

const open = () => cellDetails.set(true);

/* The map clears the selection when the background is tapped; this is the same
   thing for a thumb that has the pill under it rather than the map. */
const dismiss = (event: Event) => {
  event.stopPropagation();
  selectedCell.set(null);
};
</script>

<style>
  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    /* Above whatever the bottom tray currently is, the same way the
       attributions line clears it. */
    bottom: calc(max(var(--bottom-toolbar-height, 0px), var(--mc-safe-bottom)) + 12px);
    z-index: var(--mc-z-pill);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100vw - 32px);
    height: 36px;
    padding: 0 6px 0 12px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill-strong);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring-lg);
    color: var(--mc-text);
    font: 600 13px/1 var(--mc-font);
    cursor: pointer;
  }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge {
    font-size: 13px;
    line-height: 1;
  }

  .go {
    flex: 0 0 auto;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
  }

  .close {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mc-text-2);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }

  .hint:active {
    transform: translateX(-50%) scale(var(--mc-press));
  }

  @media (prefers-reduced-motion: reduce) {
    .hint:active { transform: translateX(-50%); }
  }
</style>

<div class="hint" role="button" tabindex="0"
  on:click={open}
  on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") open(); }}>
  <span class="swatch" style="background: {colour}"></span>
  <span class="name">{BAND_NAMES[severity]}</span>
  {#if badge}<span class="badge" style="color: {colour}">{badge}</span>{/if}
  <span class="go">details</span>
  <button type="button" class="close" on:click={dismiss} aria-label="Close">&times;</button>
</div>
