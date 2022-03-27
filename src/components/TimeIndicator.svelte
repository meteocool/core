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
    text-align: center;
    font-size: 13px;
    min-width: 40px;
    color: var(--sl-color-gray-600);
    height: 30px;
    width: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
}
</style>

{#if timeString}
<div class="tag">{timeString}</div>
{/if}
