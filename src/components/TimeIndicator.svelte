<script>
  import { capTimeIndicator } from "../stores";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";
  import { format } from 'date-fns';

  let timeString = "";

  capTimeIndicator.subscribe((value) => {
    if (value === 0) {
      timeString = "";
      return;
    }
    timeString = format(new Date(value * 1000), "HH:mm");
  });
</script>

<style>
  .tag {
      margin-left: 5px;
      text-align: center;
      width: 64px;
  }
</style>

{#if timeString}
    <sl-tag type="info" class="tag" size={dd.isApp() ? "large" : "medium" } pill>
        {timeString}
    </sl-tag>
{/if}
