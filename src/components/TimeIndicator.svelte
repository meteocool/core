<script>
import { format } from "date-fns";
import { capTimeIndicator } from "../stores";

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
  .wrap {
      width: 100%;
      text-align: center;
  }
</style>

{#if timeString}
    <sl-tag type="info" class="tag" size="medium" pill style="--sl-color-info-200: var(--sl-color-info-100);">
        <div class="wrap">
            {timeString}
        </div>
    </sl-tag>
{/if}
