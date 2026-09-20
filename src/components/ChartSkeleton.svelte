<script lang="ts">
/**
 * A placeholder bar chart for a strip that is on screen before its data is.
 *
 * The strips appear as soon as the layer does, and the query behind them takes
 * a moment -- longer on a slow connection, which is exactly when someone is
 * watching. An empty panel reads as "nothing here"; this reads as "not yet",
 * which is the truth.
 *
 * Deliberately not the real chart with fake numbers: the bars here are a fixed
 * arbitrary shape and must never be mistaken for a reading.
 *
 * The waiting signal is a crest of brightness travelling along the bars. It
 * used to be one gradient element sweeping across the whole row, which lit up
 * the gaps between the bars and the axis reserve below them as well -- a band
 * of glow crossing empty background, over and over with no pause, next to a
 * map someone is trying to read. Modulating each bar's own opacity keeps the
 * light inside the bars, and it is still one property the compositor animates
 * without repainting anything.
 */

/** How many placeholder bars. Matched to whatever the strip usually plots. */
export let bars = 30;

/* A fixed, unremarkable silhouette. Generated once rather than randomly per
   mount, so the skeleton does not flicker into a different shape on a redraw,
   and shallow enough that it never looks like weather. */
const HEIGHTS = Array.from(
  { length: bars },
  (_unused, i) => 34 + 26 * Math.abs(Math.sin(i * 0.9)) + 12 * Math.abs(Math.sin(i * 0.31)),
);

/**
 * How much later each bar crests than the one before it, in ms.
 *
 * Times the bar count this is how long the crest takes to cross the row; the
 * rest of the period is the row sitting still. Scaled so a 25-bar strip and a
 * 48-bar one take about the same time to cross rather than the wide one
 * looking twice as frantic.
 */
$: stagger = Math.round(900 / Math.max(bars, 1));
</script>

<style>
  .skeleton {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    /* Room at the bottom for the axis the real chart will draw there, so the
       bars do not jump up when the data lands. */
    padding-bottom: 18px;
    overflow: hidden;
    pointer-events: none;
  }

  .bar {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 2px 2px 0 0;
    background: var(--mc-tint);
    opacity: 0.55;
    animation: wave 2600ms var(--mc-ease) infinite;
    animation-delay: calc(var(--i) * var(--stagger));
  }

  /* The crest occupies the first third of the period and the row rests for the
     other two -- a pulse every couple of seconds rather than a strobe. */
  @keyframes wave {
    0%, 34%, 100% { opacity: 0.55; }
    14% { opacity: 1; }
  }

  /* Still says "waiting", without anything moving. */
  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
      opacity: 0.5;
    }
  }
</style>

<div class="skeleton" aria-hidden="true" style:--stagger="{stagger}ms">
  {#each HEIGHTS as height, i (i)}
    <div class="bar" style:height="{height}%" style:--i={i}></div>
  {/each}
</div>
