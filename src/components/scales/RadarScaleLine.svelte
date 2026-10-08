<script lang="ts">
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import RadarProductPicker from "../RadarProductPicker.svelte";
  import legendClouds from "../../assets/legend_clouds.svg";
  import legendRain from "../../assets/legend_rain.svg";
  import legendHail from "../../assets/legend_hail.svg";
  import legendThunderstorm from "../../assets/legend_thunderstorm.svg";
  import { onDestroy } from "svelte";
  import { radarColormap, unit } from "../../stores";
  import { dbzTicks, getPalette, rvp6ToDbz } from "../../lib/cmap_utils";

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

  $: palette = getPalette($radarColormap);
  $: ticks = $unit === "dbz"
    ? dbzTicks(palette).map(({ dbz, at }, i, all) => ({
      at,
      html: i === all.length - 1 ? `${dbz}<span class="dbz"> dBZ</span>` : String(dbz),
    }))
    : null;
  $: range = palette.split(";").map((entry) => rvp6ToDbz(Number(entry.split(":")[0])));
  $: toggleLabel = $_($unit === "dbz" ? "chrome.scales.show_pictograms" : "chrome.scales.show_dbz");
  $: hint = `${$_("chrome.scales.colormap", {
    values: { name: $radarColormap.charAt(0).toUpperCase() + $radarColormap.slice(1), min: range[0], max: range[range.length - 1] },
  })}. ${toggleLabel}`;

  function valueFormatter(fmt) {
    switch (fmt) {
      case "64":
        return " ";
      case "74":
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
    /* Muted rather than half-transparent, so it stays legible on glass. */
    :global(.dbz) {
        font-size: 70%;
        font-weight: 500;
        color: var(--mc-text-2);
        margin-left: 1px;
    }
</style>

{#key unique}
        <!-- The caption is the product picker: what the colours are a picture of. -->
        <ScaleLine valueFormat={valueFormatter} {palette} {ticks} {hint} {toggleLabel} onToggle={toggle} titleOnPhone>
            <RadarProductPicker slot="title" variant="adaptive" />
        </ScaleLine>
{/key}
