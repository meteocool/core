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
    /* Second row of the top-centre stack, under the Latest pill. */
    top: calc(var(--mc-top-stack) + var(--mc-pill-h) + 6px);
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    padding: 0 var(--mc-gutter);
    /* The banner floats over the map; only the button should swallow clicks. */
    pointer-events: none;
    z-index: var(--mc-z-status);
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(92vw, 30em);
    min-height: 32px;
    padding: 4px 6px 4px 14px;
    border-radius: var(--mc-radius-pill);
    font: 500 13px/1.25 var(--mc-font);
    color: var(--mc-text);
    background: var(--mc-glass-fill-strong);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
  }

  .label {
    font-weight: 600;
    white-space: nowrap;
  }
  .label::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 7px;
    border-radius: 50%;
    background: var(--mc-orange);
    vertical-align: 1px;
  }
  .pill.offline .label::before {
    background: var(--mc-red);
  }

  .detail {
    color: var(--mc-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  button {
    pointer-events: auto;
    flex: none;
    height: 24px;
    padding: 0 10px;
    margin: 0;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  button:hover {
    background: var(--mc-accent);
    color: #fff;
  }
  button:active {
    transform: scale(var(--mc-press));
  }

  @media only screen and (max-width: 620px) {
    .pill {
      /* between the 40px logo disc and the 44px switcher disc, each 8px off its edge */
      max-width: calc(100vw - 2 * (var(--mc-gutter) + var(--mc-control-lg) + var(--mc-gutter)));
    }
  }
</style>

{#if visible}
  <div class="mapStatus" role="status" aria-live="polite">
    <div class="pill" class:offline={!$networkStatus.online}>
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
