<script>
  import { formatDistanceToNow } from 'date-fns';
  import { _ } from 'svelte-i18n';
  import { capLastUpdated } from '../stores';

  import getDfnLocale from '../locale/locale';

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
    if (lastUpdatedStr.length < 22) {
      lastUpdatedStr = `${$_('last_updated')} ${lastUpdatedStr}`;
    }
    updateTimeout = setTimeout(updateTime, 10000);
  };

  capLastUpdated.subscribe((value) => {
    lastUpdated = value;
    if (updateTimeout > 0 || !value) window.clearTimeout(updateTimeout);
    updateTimeout = 0;
    if (value) {
      updateTime();
    } else {
      lastUpdatedStr = '';
    }
  });

  updateTime();
</script>

<style>
  .progress-ring{
    --indicator-color: rgb(52,120,246);
    position: relative;
    top: 3px; transform: scaleX(-1);
  }

  .flt {
    margin-top: 0.15em;
  }
</style>

<sl-tag
        type="info"
        size="medium"
        pill class="flt">
  {#if lastUpdatedStr}
    <sl-progress-ring
            percentage={slPercent}
            size="18"
            stroke-width="1.5"
            class="progress-ring"
    />
    {lastUpdatedStr}
  {:else}
    <sl-spinner style="--indicator-color: rgb(52,120,246); position: relative; top: 2px; margin-right: 3px; font-size: 14px; --stroke-width: 1.5px"></sl-spinner> {$_("loading")}...
  {/if}
</sl-tag>

