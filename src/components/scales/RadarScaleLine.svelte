<script lang="ts">
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import legendClouds from "../../assets/legend_clouds.svg";
  import legendRain from "../../assets/legend_rain.svg";
  import legendHail from "../../assets/legend_hail.svg";
  import legendThunderstorm from "../../assets/legend_thunderstorm.svg";
  import { onDestroy } from "svelte";
  import { radarColormap, unit } from "../../stores";
  import { getPalette } from "../../lib/cmap_utils";

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

  function valueFormatter(fmt) {
    if ($unit === "dbz") {
      if (fmt % 10 === 0) {
        return `${Math.round(fmt / 2 - 32.5)}<span class="dbz"> dBZ</span>`;
      }
      return "";
    }
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
        <ScaleLine valueFormat={valueFormatter} palette="{getPalette($radarColormap)}" prettyName="{$radarColormap}" title="Radarkomposit<br />(DWD 1km)"/>
{/key}
