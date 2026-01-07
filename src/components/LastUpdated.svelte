<script>
  import { formatDistanceToNow } from 'date-fns'
  import { _ } from 'svelte-i18n'
  import { capLastUpdated, lastFocus } from '../stores'

  import getDfnLocale from '../locale/locale'

  let lastUpdated
  let lastUpdatedStr = $state()
  let slPercent = $state(75)
  let updateTimeout = 0
  let loading = $state(false)
  const ringRadius = 9
  const ringCircumference = 2 * Math.PI * ringRadius
  let ringOffset = $derived(ringCircumference * (1 - slPercent / 100))

  const updateTime = () => {
    if (!lastUpdated) return
    lastUpdatedStr = Math.abs((lastUpdated - new Date()) / 1000)
    slPercent = 100 - Math.min((lastUpdatedStr / 300) * 100, 100)
    lastUpdatedStr = formatDistanceToNow(lastUpdated, {
      locale: getDfnLocale(),
      addSuffix: true,
    })
    if (lastUpdatedStr.length < 22) {
      lastUpdatedStr = `${$_('last_updated')} ${lastUpdatedStr}`
    }
    updateTimeout = setTimeout(updateTime, 10000)
    loading = false
  }

  let lastFocusDt = new Date()
  lastFocus.subscribe((updated) => {
    if (updated.getTime() - 60 * 1000 > lastFocusDt.getTime()) {
      lastUpdatedStr = ''
    }
    lastFocusDt = updated
    loading = true
  })

  capLastUpdated.subscribe((value) => {
    lastUpdated = value
    if (updateTimeout > 0 || !value) window.clearTimeout(updateTimeout)
    updateTimeout = 0
    if (value) {
      updateTime()
    } else {
      lastUpdatedStr = ''
    }
  })

  updateTime()
</script>

<div class="info">
  {#if lastUpdatedStr}
    {#if loading}
      <span class="spinner" aria-label={$_('loading')}></span>
    {:else}
      <svg class="progress-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle class="progress-ring__track" cx="10" cy="10" r={ringRadius}></circle>
        <circle
          class="progress-ring__indicator"
          cx="10"
          cy="10"
          r={ringRadius}
          stroke-dasharray={ringCircumference}
          stroke-dashoffset={ringOffset}
        ></circle>
      </svg>
    {/if}
    {lastUpdatedStr}
  {:else}
    <span class="spinner" aria-label={$_('loading')}></span> {$_('loading')}...
  {/if}
</div>

<style>
  .progress-ring {
    position: relative;
    top: 6px;
    transform: scaleX(-1);
  }

  .progress-ring__track,
  .progress-ring__indicator {
    fill: none;
    stroke-width: 1.5;
  }

  .progress-ring__track {
    stroke: rgba(52, 120, 246, 0.2);
  }

  .progress-ring__indicator {
    stroke: rgb(52, 120, 246);
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transition: stroke-dashoffset 0.2s linear;
  }

  .spinner {
    position: relative;
    top: 5px;
    margin-top: 3px;
    margin-right: 3px;
    transform: scaleX(-1);
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(52, 120, 246, 0.2);
    border-top-color: rgb(52, 120, 246);
    display: inline-block;
    animation: spin 0.8s linear infinite;
  }

  .info {
    color: var(--sl-color-gray-600);
    font-size: 13px;
    flex-shrink: 0;
    flex-wrap: nowrap;
    min-width: 100px;
    white-space: nowrap;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg) scaleX(-1);
    }
    to {
      transform: rotate(360deg) scaleX(-1);
    }
  }
</style>
