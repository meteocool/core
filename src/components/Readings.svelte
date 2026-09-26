<script lang="ts">
/**
 * A storm's numbers, two to a row, each with its severity class as a meter.
 *
 * The panels' "Readings" block, shared so a cell's peak and a storm core's
 * peak are the same line in the same colours. See lib/cellMetrics.ts for the
 * classes.
 */
import type { Reading } from "../lib/cellMetrics";

/** `fill: null` is a reading with no scale to measure it on, and no meter. */
export let items: Array<Omit<Reading, "fill"> & { fill: number | null }>;
</script>

<ul class="metrics">
  {#each items as item (item.key)}
    <li class="metric" data-band={item.band ?? "none"} title={item.bandName ?? ""}>
      <span class="name">{item.label}</span>
      <span class="value">{item.text}</span>
      <!-- The meter is the reading again as a length. Colour alone would
           leave the bands unreadable to anyone who cannot separate the
           hues, and this popup has no room to spell the class out six
           times over. -->
      {#if item.fill !== null}
        <span class="meter"><span class="fill" style="width: {item.fill * 100}%"></span></span>
      {/if}
      {#if item.bandName}<span class="sr-only">{item.bandName}</span>{/if}
    </li>
  {/each}
</ul>

<style>
  /*
   * The four DWD severity classes, as a fill for the meter and a darker step
   * of the same hue for the figure beside it.
   *
   * Two steps per band rather than one because the fill and the figure are
   * held to different bars: a bar of colour needs to be seen, a numeral needs
   * to be read. Amber at the weight that reads correctly as a fill sits near
   * 1.9:1 against white -- fine behind a bar, illegible as a digit -- so the
   * figures wear steps measured to clear 4.5:1 against each of the two
   * surfaces this panel actually uses, rather than one compromise step that is
   * wrong on both.
   */
  .metric[data-band="0"] { --band: #2f9e44; --band-ink: #1b7a31; }
  .metric[data-band="1"] { --band: #f0b429; --band-ink: #8a5e05; }
  .metric[data-band="2"] { --band: #e03131; --band-ink: #b02020; }
  .metric[data-band="3"] { --band: #9c36b5; --band-ink: #7a219a; }
  .metric[data-band="none"] { --band: currentColor; --band-ink: currentColor; }

  /* Keyed to the class ui.ts toggles rather than to prefers-color-scheme: the
     app's own theme switch has to win over the system on iOS and Android. */
  :global(html.sl-theme-dark) .metric[data-band="0"] { --band-ink: #57c96a; }
  :global(html.sl-theme-dark) .metric[data-band="1"] { --band-ink: #f5c95c; }
  :global(html.sl-theme-dark) .metric[data-band="2"] { --band-ink: #ff8585; }
  :global(html.sl-theme-dark) .metric[data-band="3"] { --band-ink: #d68bea; }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px 14px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .metric {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    align-content: start;
    gap: 0 6px;
  }
  .name {
    opacity: 0.6;
    font-size: 11px;
  }
  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--band-ink);
    font-weight: 600;
    white-space: nowrap;
  }
  .meter {
    grid-column: 1 / -1;
    height: 3px;
    margin-top: 3px;
    border-radius: 2px;
    /* A light step of the same hue, so the band reads across the whole track
       and not only across the filled part of it. The neutral underneath is
       for engines without `color-mix`: the track still shows how long the
       bar could be, which is the part that has to survive. */
    background: rgba(128, 128, 128, 0.16);
    background: color-mix(in srgb, var(--band) 20%, transparent);
    overflow: hidden;
  }
  .metric[data-band="none"] .meter { background: rgba(128, 128, 128, 0.16); }
  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--band);
  }
  /* The class name in words. Colour is the glance and the meter is the
     fallback for anyone it does not reach, but a screen reader gets neither. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
