<script lang="ts">
import { formatDistanceToNow } from "date-fns";
import { _ } from "svelte-i18n";
import { onDestroy } from "svelte";
import { capLastUpdated, lastFocus } from "../stores";

import getDfnLocale from "../locale/locale";

let lastUpdated;
let lastUpdatedStr;
let slPercent = 75;
let updateTimeout: ReturnType<typeof setTimeout> | null = null;
let loading = false;

/* Self-rescheduling, so it first cancels whatever it scheduled last time.
   Without that, the subscription below (which fires synchronously on subscribe
   and calls this) and the trailing call that used to sit at the bottom of this
   script each started a chain, and only the last id written to updateTimeout
   could ever be cleared -- the other one ticked for the life of the page, once
   per mounted-and-discarded toolbar. */
const updateTime = () => {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = null;
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

/* This component is created and destroyed with the toolbar mode, so both
   subscriptions and the self-rescheduling timer have to be handed back --
   otherwise every open/close leaves another live 10s tick behind, formatting
   a timestamp for a component that is no longer on the page. */
const subscriptions: (() => void)[] = [];

let lastFocusDt = new Date();
subscriptions.push(lastFocus.subscribe((updated) => {
  if (updated.getTime() - (60 * 1000) > lastFocusDt.getTime()) {
    lastUpdatedStr = "";
  }
  lastFocusDt = updated;
  loading = true;
}));

subscriptions.push(capLastUpdated.subscribe((value) => {
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
}));

onDestroy(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (updateTimeout) clearTimeout(updateTimeout);
});
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

