<script>
import { formatDistanceToNow } from "date-fns";
import { _ } from "svelte-i18n";
import { capLastUpdated } from "../stores";
import getDfnLocale from "../locale/locale";

let lastUpdated;
let lastUpdatedStr;
let slPercent = 75;
let updateTimeout = 0;

const updateTime = () => {
  if (!lastUpdated) return;
  lastUpdatedStr = Math.abs((lastUpdated - new Date()) / 1000);
  slPercent = 100 - Math.min(((lastUpdatedStr) / 300) * 100, 100);
  lastUpdatedStr = formatDistanceToNow(lastUpdated, {
    locale: getDfnLocale(),
    addSuffix: true,
  });
  updateTimeout = setTimeout(updateTime, 10000);
};

capLastUpdated.subscribe((value) => {
  lastUpdated = value;
  if (updateTimeout > 0 || !value) window.clearTimeout(updateTimeout);
  updateTimeout = 0;
  if (value) updateTime();
});

updateTime();
</script>

<style>
  .tag{
    text-indent: unset;
    font-style: normal;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
  }

  .progress-ring{
    --indicator-color: rgb(52,120,246);
    position: relative;
    top: 3px; transform: scaleX(-1);
  }
</style>

<sl-tag
        type="info"
        class="tag"
        size="medium"
        pill>
  {#if lastUpdatedStr}
  <sl-progress-ring
          percentage={slPercent}
          size="18"
          stroke-width="1.5"
          class="progress-ring"
  />
  {$_("last_updated")}
  {lastUpdatedStr}
  {:else}
    <sl-spinner style="--indicator-color: rgb(52,120,246); position: relative; top: 2px; margin-right: 3px; font-size: 14px; --stroke-width: 1.5px"></sl-spinner> Loading...
  {/if}
</sl-tag>
