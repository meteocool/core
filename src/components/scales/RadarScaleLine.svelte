<script>
  import { _ } from "svelte-i18n";
  import ScaleLine from "./ScaleLine.svelte";
  import legendClouds from "../../../public/assets/legend_clouds.svg";
  import legendRain from "../../../public/assets/legend_rain.svg";
  import legendHail from "../../../public/assets/legend_hail.svg";
  import legendThunderstorm from "../../../public/assets/legend_thunderstorm.svg";
  import { radarColormap, unit } from "../../stores";
  import { getPalette } from "../../lib/cmap_utils";

  let unique = {};

  function restart() {
    unique = {}; // every {} is unique, {} === {} evaluates to false
  }

  unit.subscribe(() => {
    restart();
  });
  radarColormap.subscribe(() => {
    restart();
  });

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
    :global(.dbz) {
        font-size: 50%;
        opacity: 0.5;
    }

</style>

{#key unique}
        <ScaleLine valueFormat={valueFormatter} palette="{getPalette($radarColormap)}" prettyName="{$radarColormap}" title="Radarkomposit<br />(DWD 1km)"/>
{/key}
