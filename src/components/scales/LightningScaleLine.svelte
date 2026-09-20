<script lang="ts">
  import ScaleLine from "./ScaleLine.svelte";
  import { onDestroy } from "svelte";
  import { radarColormap, unit } from "../../stores";
  import { LightningColors } from "../../colormaps";
  import { DeviceDetect as dd } from "../../lib/DeviceDetect";

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

  const legendItems = [1, 2, 3, 5, 20, 30, 60, 90, 120];
  const isApp = dd.isApp();
</script>

<style>
    /* Muted rather than half-transparent, so it stays legible on glass. */
    :global(.minutes) {
        font-size: 70%;
        font-weight: 500;
        color: var(--mc-text-2);
        margin-left: 1px;
    }
</style>

{#key unique}
    <ScaleLine class="scale" valueFormat={ (value) => {
      const intValue = parseInt(value, 10);
      if (legendItems.includes(intValue)) {
        if (isApp) {
          return `${value} min`;
        }
        return `${value} <span class="minutes"> Minute${intValue === 1 ? "" : "s"}</span>`;
      }
      return "";
    }}
               palette="{LightningColors.map((value, index) => `${index}:${value.slice(1)}`).join(";")}"
               prettyName="" title="Blitzortung.org<br />Live"/>
{/key}
