<script lang="ts">
  import { onDestroy } from "svelte";
  import { formatDistanceToNow } from "date-fns";
  import { _ } from "svelte-i18n";
  import getDfnLocale from "../locale/locale";
  import { networkStatus, tileStatus, tileRefreshSignal } from "../stores";
  import { shouldShowNetworkBanner } from "../lib/networkBanner";

  // Re-render the relative timestamp on a timer, but only while the banner is
  // up: a minute hand ticking behind a hidden element is pure wakeups.
  const TICK_MS = 30 * 1000;

  $: visible = shouldShowNetworkBanner($networkStatus);
  $: label = $networkStatus.online ? $_("slow_connection") : $_("offline");

  let tick = 0;
  let timer: number | undefined;

  // Driven from a function rather than a reactive block: a `$:` that both reads
  // and assigns `timer` re-runs on its own write.
  function syncTicker(showing: boolean) {
    if (showing && timer === undefined) {
      timer = window.setInterval(() => { tick += 1; }, TICK_MS);
    } else if (!showing && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  $: syncTicker(visible);

  onDestroy(() => {
    if (timer !== undefined) window.clearInterval(timer);
  });

  // `tick` is read so the expression re-evaluates on the timer.
  $: lastSuccess = ((): string | null => {
    void tick;
    const at = $tileStatus.lastSuccessAt;
    if (at === null) return null;
    return formatDistanceToNow(new Date(at), { addSuffix: true, locale: getDfnLocale() });
  })();

  function retry() {
    tileRefreshSignal.update((n) => n + 1);
  }
</script>

<style>
  .mapStatus {
    position: absolute;
    /* Below the "Latest" pill, which owns the top centre. Both are absolute,
       so without the offset this lands straight on top of it. */
    top: calc(env(safe-area-inset-top) + 2.6em);
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    /* The banner floats over the map; only the button should swallow clicks. */
    pointer-events: none;
    z-index: 900000;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.6em;
    max-width: min(92vw, 30em);
    padding: 0.45em 0.9em;
    border-radius: var(--sl-border-radius-pill, 9999px);
    font-size: 0.85rem;
    line-height: 1.25;
    color: var(--sl-color-black, #000);
    background: var(--sl-color-white, #fff);
    border: 1px solid var(--sl-color-gray-300, #d4d4d8);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  .label {
    font-weight: 600;
    white-space: nowrap;
  }

  .detail {
    color: var(--sl-color-gray-600, #52525b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    pointer-events: auto;
    flex: none;
    padding: 0.2em 0.7em;
    border: 1px solid var(--sl-color-gray-300, #d4d4d8);
    border-radius: var(--sl-border-radius-pill, 9999px);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }

  button:hover {
    background: var(--sl-color-gray-200, #e4e4e7);
  }
</style>

{#if visible}
  <div class="mapStatus" role="status" aria-live="polite">
    <div class="pill">
      <span class="label">{label}</span>
      {#if lastSuccess}
        <span class="detail">{$_("last_success")} {lastSuccess}</span>
      {/if}
      {#if !$networkStatus.online}
        <button type="button" on:click={retry}>{$_("retry")}</button>
      {/if}
    </div>
  </div>
{/if}
