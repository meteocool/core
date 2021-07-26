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
  }
</style>

{#if timeString}
    <sl-tag type="info" class="tag" size={dd.isApp() ? "large" : "medium" } pill>
        <div style="width: 60px;">
            {timeString}
        </div>
    </sl-tag>
{/if}
