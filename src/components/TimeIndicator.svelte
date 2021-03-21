<script>
  import { capTimeIndicator } from "../stores";
  import { DeviceDetect as dd } from "../lib/DeviceDetect";

  let timeString = "";

  capTimeIndicator.subscribe((value) => {
    if (!value) {
      timeString = "";
      return;
    }
    timeString = value;
  });
</script>

<style>
  .tag {
    text-indent: unset;
    font-style: normal;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
      /*position: absolute;
    top: max(calc(env(safe-area-inset-top) + 10px), 1vh);
    z-index: 999999;
      margin-left: auto;
      margin-right: auto;
    left: 0;
    right: 0;
    width: 155px;
       */
  }
</style>

{#if timeString !== ""}
    <sl-tag type="info" class="tag" size={dd.isApp() ? "large" : "medium" } pill>
        {timeString}
    </sl-tag>
{/if}
