<script>
import { formatDistanceToNow } from "date-fns";
import { _ } from "svelte-i18n";
import { capLastUpdated, lastFocus } from "../stores";

import getDfnLocale from "../locale/locale";

let lastUpdated;
let lastUpdatedStr;
let slPercent = 75;
let updateTimeout = 0;
let loading = false;

const updateTime = () => {
  if (!lastUpdated) return;
  lastUpdatedStr = Math.abs((lastUpdated - new Date()) / 1000);
  slPercent = 100 - Math.min(((lastUpdatedStr) / 300) * 100, 100);
  lastUpdatedStr = formatDistanceToNow(lastUpdated, {
    locale: getDfnLocale(),
    addSuffix: true,
  });
  if (lastUpdatedStr.length < 22) {
    lastUpdatedStr = `${$_("last_updated")} ${lastUpdatedStr}`;
  }
  updateTimeout = setTimeout(updateTime, 10000);
  loading = false;
};

lastFocus.subscribe(() => {
  loading = true;
});

capLastUpdated.subscribe((value) => {
  lastUpdated = value;
  if (updateTimeout > 0 || !value) window.clearTimeout(updateTimeout);
  updateTimeout = 0;
  if (value) {
    updateTime();
  } else {
    lastUpdatedStr = "";
  }
});

updateTime();
</script>

<style>
.progress-ring {
    --indicator-color: rgb(52, 120, 246);
    position: relative;
    top: 3px;
    transform: scaleX(-1);
}

.spinner {
    --indicator-color: rgb(52, 120, 246);
    --stroke-width: 1.5px;
    position: relative;
    top: 2px;
    margin-right: 3px;
    font-size: 14px;
}
</style>

<sl-tag
        pill
        size="medium"
        type="info">
    {#if lastUpdatedStr}
        {#if loading}
            <sl-spinner class="spinner"></sl-spinner>
        {:else}
            <sl-progress-ring
                    percentage={slPercent}
                    size="18"
                    stroke-width="1.5"
                    class="progress-ring"></sl-progress-ring>
        {/if}
        {lastUpdatedStr}
    {:else}
        <sl-spinner class="spinner"></sl-spinner> {$_("loading")}...
    {/if}
</sl-tag>

