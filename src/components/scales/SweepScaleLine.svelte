<script lang="ts">
  /**
   * The legend for a radar's correlation coefficient, differential
   * reflectivity, shear or divergence: the palette its sweep is drawn in
   * (colormaps.ts), along the legend's own axis (lib/siteSweeps.ts), which
   * gives the coefficient's 0.8 to 1 most of the strip. Its labels thin out
   * where the strip has no room for all of them, as on a phone.
   */
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import { SWEEP_COLOURS } from "../../colormaps";
  import { legendValue, SWEEP_LEGENDS, sweepLegendTicks } from "../../lib/siteSweeps";
  import type { Quantity } from "../../lib/siteSweeps";
  import type { Encoding } from "../../lib/sweep";

  export let quantity: Quantity;

  const ENCODINGS: Partial<Record<Quantity, Encoding>> = {
    rhohv: "rhohv-u8", zdr: "zdr-u8", shear: "shear-u8", divergence: "divshear-u8",
  };
  const STEPS = 60;

  $: legend = SWEEP_LEGENDS[quantity];
  $: colour = SWEEP_COLOURS[ENCODINGS[quantity] ?? "rhohv-u8"]!;
  $: palette = legend ? Array.from({ length: STEPS + 1 }, (_value, i) => {
    const value = legendValue(legend.knots, i / STEPS);
    const [r, g, b] = colour(value);
    return `${value}:${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }).join(";") : "";
  let stripWidth = 0;
  $: ticks = legend ? sweepLegendTicks(legend, stripWidth).map(({ at, label }) => ({ at, html: label })) : [];
</script>

<ScaleLine class="scale" {palette} {ticks} bind:stripWidth titleOnPhone
  title={$_(`site.legend.${quantity}`)}
  hint={$_(`site.legend.${quantity}_hint`)} />
