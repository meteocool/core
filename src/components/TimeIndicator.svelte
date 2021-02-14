<script>
  import { capTimeIndicator } from '../stores';

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
    position: absolute;
    z-index: 999999;
    top: max(calc(env(safe-area-inset-top) + 10px), 1vh);
    margin-left: auto;
    margin-right: auto;
    left: 0;
    right: 0;
    width: 155px; /* XXX make dependant on content */
  }
</style>

{#if timeString !== ""}
    <sl-tag type="info" class="tag" size="large" pill>
        {timeString}
    </sl-tag>
{/if}
