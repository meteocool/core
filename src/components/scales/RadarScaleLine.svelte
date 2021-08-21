<script>
import { _ } from "svelte-i18n";
import ScaleLine from "./ScaleLine.svelte";
import legendClouds from "../../../public/assets/legend_clouds.svg";
import legendRain from "../../../public/assets/legend_rain.svg";
import legendHail from "../../../public/assets/legend_hail.svg";
import legendThunderstorm from "../../../public/assets/legend_thunderstorm.svg";
import { radarColormap } from "../../stores";
import { getPalette } from "../../colormaps";

const mode = "dbz";
</script>

<style>
    :global(.dbz) {
        font-size: 50%;
        opacity: 0.5;
    }
</style>

<ScaleLine class="scale" valueFormat={ (fmt) => {
  if (mode === "dbz") {
    if (fmt % 10 === 0) {
      return `${fmt}<span class="dbz"> dBZ</span>`;
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
    }} palette="{getPalette($radarColormap)}" />
