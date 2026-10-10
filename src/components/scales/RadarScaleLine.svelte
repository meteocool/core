<script lang="ts">
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import legendClouds from "../../assets/legend_clouds.svg";
  import legendRain from "../../assets/legend_rain.svg";
  import legendHail from "../../assets/legend_hail.svg";
  import legendThunderstorm from "../../assets/legend_thunderstorm.svg";
  import { onDestroy } from "svelte";
  import { radarColormap, unit } from "../../stores";
  import { dbzTicks, getPalette, paletteFrom, rvp6ToDbz } from "../../lib/cmap_utils";

  let unique = {};

  function restart() {
    unique = {}; // every {} is unique, {} === {} evaluates to false
  }

  // Rebuilt whenever the toolbar swaps capability or mode, so both go back.
  const subscriptions = [
    unit.subscribe(() => restart()),
    radarColormap.subscribe(() => restart()),
  ];
  onDestroy(() => subscriptions.forEach((unsubscribe) => unsubscribe()));

  /* The strip says what the colours are in pictograms, or in dBZ: a click
     on it switches, and the choice is kept (`radarLegendUnit`). */
  const toggle = () => window.settings.set("radarLegendUnit", $unit === "dbz" ? "pictogram" : "dbz");

  /* Where the strip starts. Below it every palette only fades in, which spent
     the first seventh of the classic strip on near-white. The map still draws
     those values, as faintly as before. */
  const LEGEND_FROM_DBZ = 5;

  /* A tick this close to the end is right-aligned against it, and with the
     unit on it ran into the one before: 50 and "60 dBZ" read as bunched up,
     on a scale that is even. Left off; the unit goes on the last one kept. */
  const END_CLEARANCE = 0.95;

  $: palette = paletteFrom(getPalette($radarColormap), LEGEND_FROM_DBZ);
  $: ticks = $unit === "dbz"
    ? dbzTicks(palette).filter(({ at }) => at <= END_CLEARANCE).map(({ dbz, at }, i, all) => ({
      at,
      html: i === all.length - 1 ? `${dbz}<span class="dbz">dBZ</span>` : String(dbz),
    }))
    : null;
  $: range = palette.split(";").map((entry) => rvp6ToDbz(Number(entry.split(":")[0])));
  $: toggleLabel = $_($unit === "dbz" ? "chrome.scales.show_pictograms" : "chrome.scales.show_dbz");
  $: hint = `${$_("chrome.scales.colormap", {
    values: { name: $radarColormap.charAt(0).toUpperCase() + $radarColormap.slice(1), min: range[0], max: range[range.length - 1] },
  })}. ${toggleLabel}`;

  function valueFormatter(fmt) {
    switch (fmt) {
      // Selectors, not positions: the pictograms are spread evenly along the
      // strip, a spacer first, so each only has to be a value the strip holds.
      case "75":
        return " ";
      case "84":
        return `<img src=${legendClouds} alt='${$_("drizzle")}' class="legend-icon" /> <span class='legendLabel'>${$_("drizzle")}</span>`;
      case "94":
        return `<img src=${legendRain} alt='${$_("rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("rain")}</span>`;
      case "104":
        return `<img src=${legendThunderstorm} alt='${$_("heavy_rain")}' class="legend-icon"/> <span class='legendLabel'>${$_("heavy_rain")}</span>`;
      case "114":
        return `<img src=${legendHail} alt='${$_("hail")}' class="legend-icon"/> <span class='legendLabel'>${$_("hail")}</span>`;
      default:
        return "";
    }
  }
</script>


<style>
    /* Muted rather than half-transparent, so it stays legible on glass.
       Hung off the number rather than part of it, so the number stays
       centred on its colour. */
    :global(.dbz) {
        position: absolute;
        left: 100%;
        font-size: 70%;
        font-weight: 500;
        color: var(--mc-text-2);
        margin-left: 2px;
    }
</style>

{#key unique}
        <!-- No caption: the product picker above it in the player says what the
             colours are a picture of. -->
        <ScaleLine valueFormat={valueFormatter} {palette} {ticks} {hint} {toggleLabel} onToggle={toggle} />
{/key}
