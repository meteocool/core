<script lang="ts">
  /**
   * The legend for an echo top or VIL, in place of the dBZ strip while one is
   * drawn (`drawnEncoding`): its encoding's own palette (lib/columnValues.ts),
   * named in kilometres above sea level or kilograms a square metre. Laid out
   * as the dBZ strip is, each number under its colour and the unit hung off
   * the last, with no caption: the product picker above it says which top it
   * is. Not a toggle: there are no pictograms for a height.
   */
  import { _, locale } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import { ECHO_TOP_ENCODING, columnLegend } from "../../lib/columnValues";
  import type { ColumnEncoding } from "../../lib/columnValues";

  export let encoding: ColumnEncoding;

  /* As the dBZ strip's: a tick this close to the end runs into the one
     before once the unit is on it, so it is left off. */
  const END_CLEARANCE = 0.95;

  const format = (value: number, tag: string | null | undefined) => value.toLocaleString(tag ?? "en");

  $: legend = columnLegend(encoding);
  $: ticks = legend.ticks.filter(({ at }) => at <= END_CLEARANCE).map(({ value, at }, i, all) => ({
    at,
    html: i === all.length - 1
      ? `${format(value, $locale)}<span class="scale-unit">${legend.unit}</span>`
      : format(value, $locale),
  }));
  $: hint = $_(encoding === ECHO_TOP_ENCODING ? "chrome.scales.echotop" : "chrome.scales.vil", {
    values: { min: format(legend.min, $locale), max: format(legend.max, $locale) },
  });
</script>

<style>
  /* The dBZ strip's unit (RadarScaleLine.svelte), for km and kg/m². */
  :global(.scale-unit) {
    position: absolute;
    left: 100%;
    font-size: 70%;
    font-weight: 500;
    color: var(--mc-text-2);
    margin-left: 2px;
  }
</style>

<ScaleLine palette={legend.palette} {ticks} {hint} />
