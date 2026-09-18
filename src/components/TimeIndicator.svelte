<script lang="ts">
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
/* The frame clock: a flat tint capsule inside the glass player tray, with a
   fixed minimum width so the row never shifts between 09:55 and 10:00. */
.tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    width: auto;
    height: var(--mc-pill-h);
    padding: 0 10px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 13px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-align: center;
}
</style>

{#if timeString}
<div class="tag">{timeString}</div>
{/if}
