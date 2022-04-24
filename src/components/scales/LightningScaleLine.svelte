<script>
  import ScaleLine from './ScaleLine.svelte';
  import { radarColormap, unit } from '../../stores';
  import { LightningColors } from '../../colormaps';

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
</script>

<style>
    :global(.minutes) {
        font-size: 50%;
        opacity: 0.5;
    }
</style>

{#key unique}
    <ScaleLine class="scale" valueFormat={ (_, index) => {
      if (index === 1) {
        return `1 <span class="minutes"> Minute</span>`;
      }
      if (index === 5) {
        return `5 <span class="minutes"> Minutes</span>`;
      }
      if (index === 10) {
        return `20 <span class="minutes"> Minutes</span>`;
      }
      if (index === 10) {
        return `30 <span class="minutes"> Minutes</span>`;
      }
      if (index === 20) {
        return `1 <span class="minutes"> Hour</span>`;
      }
      if (index === 40) {
        return `2 <span class="minutes"> Hours</span>`;
      }
      return "";
    }}
               palette="{LightningColors.map((value, index) => `${index}:${value.slice(1)}`).join(';')}"
               prettyName="foo"/>
{/key}
