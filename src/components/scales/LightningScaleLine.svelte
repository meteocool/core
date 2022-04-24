<script>
  import ScaleLine from "./ScaleLine.svelte";
  import { radarColormap, unit } from "../../stores";
  import { LightningColors } from "../../colormaps";

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

  const legendItems = [1, 2, 3, 5, 20, 30, 60, 90, 120];
</script>

<style>
    :global(.minutes) {
        font-size: 50%;
        opacity: 0.5;
    }
</style>

{#key unique}
    <ScaleLine class="scale" valueFormat={ (value) => {
      const intValue = parseInt(value, 10);
      if (legendItems.includes(intValue)) {
        return `${value} <span class="minutes"> Minute${intValue === 1 ? "" : "s"}</span>`;
      }
      return "";
    }}
               palette="{LightningColors.map((value, index) => `${index}:${value.slice(1)}`).join(';')}"
               prettyName="" title="Blitzortung.org<br />Global"/>
{/key}
