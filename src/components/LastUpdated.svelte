<script lang="ts">
import { formatDistanceToNow } from "date-fns";
import { _ } from "svelte-i18n";
import { capLastUpdated, lastFocus } from "../stores";

import getDfnLocale from "../locale/locale";

let lastUpdated;
let lastUpdatedStr;
let slPercent = 75;
let updateTimeout: ReturnType<typeof setTimeout> | null = null;
let loading = false;

const updateTime = () => {
  if (!lastUpdated) return;
  const ageSeconds = Math.abs((lastUpdated.getTime() - Date.now()) / 1000);
  slPercent = 100 - Math.min((ageSeconds / 300) * 100, 100);
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

let lastFocusDt = new Date();
lastFocus.subscribe((updated) => {
  if (updated.getTime() - (60 * 1000) > lastFocusDt.getTime()) {
    lastUpdatedStr = "";
  }
  lastFocusDt = updated;
  loading = true;
});

capLastUpdated.subscribe((value) => {
  lastUpdated = value;
  if (updateTimeout || !value) {
    if (updateTimeout) clearTimeout(updateTimeout);
  }
  updateTimeout = null;
  if (value) {
    updateTime();
  } else {
    lastUpdatedStr = "";
  }
});

updateTime();
</script>

<style>
/* Inline status inside the tray: no material of its own.
   sl-progress-ring props: --size --track-width --track-color --indicator-width --indicator-color */
.progress-ring {
    --size: 18px;
    --track-width: 2px;
    --indicator-width: 2px;
    --track-color: var(--mc-separator);
    --indicator-color: var(--mc-accent);
    --indicator-transition-duration: 0.35s;
    position: relative;
    top: 0;
    transform: scaleX(-1);   /* keeps the ring depleting clockwise */
    flex: none;
}

/* sl-spinner props: --track-width --track-color --indicator-color --speed */
.spinner {
    --track-width: 2px;
    --track-color: var(--mc-separator);
    --indicator-color: var(--mc-accent);
    position: relative;
    top: 0;
    margin: 0;
    font-size: 16px;
    transform: none;
    flex: none;
}

.info {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 100px;
    color: var(--mc-text-2);
    font: 500 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
}
</style>

<div class="info">
    {#if lastUpdatedStr}
        {#if loading}
            <sl-spinner class="spinner"></sl-spinner>
        {:else}
            <sl-progress-ring
                    value={slPercent}
                    size="20"
                    stroke-width="1.5"
                    class="progress-ring"></sl-progress-ring>
        {/if}
        {lastUpdatedStr}
    {:else}
        <sl-spinner class="spinner"></sl-spinner> {$_("loading")}...
    {/if}
</div>

