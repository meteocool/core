<script>
  import { onDestroy } from 'svelte'
  import { _ } from 'svelte-i18n'
  import { formatDistanceToNow } from 'date-fns'
  import getDfnLocale from '../locale/locale'
  import { networkStatus, tileRefreshSignal, tileStatus } from '../stores'
  import { shouldShowNetworkBanner } from '../lib/networkBanner'

  let net = $state({ online: true, effectiveType: null, isSlow: false })
  let tile = $state({ inFlight: 0, lastSuccessAt: null, lastErrorAt: null, lastErrorMessage: '', lastErrorType: '', stale: false })

  const netUnsub = networkStatus.subscribe((value) => {
    net = value
  })

  const tileUnsub = tileStatus.subscribe((value) => {
    tile = value
  })

  let tick = $state(0)
  let tickInterval

  onDestroy(() => {
    netUnsub?.()
    tileUnsub?.()
  })

  const showOverlay = $derived.by(() => shouldShowNetworkBanner(net))

  const statusLabel = $derived.by(() => {
    if (!net.online) return $_('offline')
    if (net.isSlow) return $_('slow_connection')
    return ''
  })

  const lastSuccessText = $derived.by(() => {
    tick
    if (!tile.lastSuccessAt) return ''
    return `${$_('last_success')} ${formatDistanceToNow(tile.lastSuccessAt, { locale: getDfnLocale(), addSuffix: true })}`
  })

  const showRetry = $derived.by(() => !net.online)

  const retry = () => {
    tileRefreshSignal.update((value) => value + 1)
  }
  $effect(() => {
    if (!showOverlay || !tile.lastSuccessAt) {
      if (tickInterval) {
        window.clearInterval(tickInterval)
        tickInterval = null
      }
      return
    }
    tickInterval = window.setInterval(() => {
      tick += 1
    }, 30000)
    return () => {
      if (tickInterval) {
        window.clearInterval(tickInterval)
        tickInterval = null
      }
    }
  })
</script>

{#if showOverlay}
  <div class="map-status" role="status" aria-live="polite">
    <div class="map-status__content">
      <div class="map-status__label">{statusLabel}</div>
      {#if lastSuccessText}
        <div class="map-status__sub">{lastSuccessText}</div>
      {/if}
    </div>
    {#if showRetry}
      <button type="button" class="map-status__retry" onclick={retry}>{$_('retry')}</button>
    {/if}
  </div>
{/if}

<style>
  .map-status {
    position: absolute;
    left: 50%;
    top: calc(env(safe-area-inset-top) + 12px);
    bottom: auto;
    transform: translateX(-50%);
    z-index: 900000;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    color: var(--sl-color-black);
    border: 1px solid var(--sl-color-gray-200);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    font-size: 0.75rem;
    pointer-events: none;
  }

  .map-status__content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .map-status__label {
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .map-status__sub {
    color: var(--sl-color-gray-600);
  }

  .map-status__retry {
    pointer-events: auto;
    border: none;
    background: var(--sl-color-gray-100);
    color: var(--sl-color-black);
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .map-status__retry:hover {
    background: var(--sl-color-gray-200);
  }
</style>
