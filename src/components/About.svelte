<script>
  import { _ } from 'svelte-i18n'
  import { onDestroy, onMount } from 'svelte'

  let { onclose } = $props()

  function close() {
    onclose?.()
  }

  function onBackdropClick(event) {
    if (event.currentTarget === event.target) {
      close()
    }
  }

  let keyHandler
  onMount(() => {
    keyHandler = (event) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', keyHandler)
  })

  onDestroy(() => {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler)
      keyHandler = null
    }
  })
</script>

<div
  class="dialog-backdrop"
  role="button"
  aria-label="Close dialog"
  tabindex="0"
  onclick={onBackdropClick}
  onkeydown={(event) => (event.key === 'Enter' || event.key === ' ') && onBackdropClick(event)}
>
  <div class="dialog-overview dialog" role="dialog" aria-modal="true" aria-label={$_('title')} tabindex="0">
    <span>{$_('text1')}</span>
    <div class="appstoreLogo">
      <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623"
        ><img src="assets/ios-app-store.png" alt="ios app store link" class="appstore-logo about" /></a
      >
      <a href="https://play.google.com/store/apps/details?id=com.meteocool"
        ><img class="appstore-logo about" alt="google play app store" src="assets/google-play-store.png" /></a
      >
    </div>
    <h2>{$_('features.header')}</h2>
    <ul>
      <li>
        <strong>{$_('features.list_title1')}</strong>
        {$_('features.list1')}
      </li>
      <li>
        <strong>{$_('features.list_title2')}</strong>
        {$_('features.list2')}
      </li>
      <li>
        <strong>{$_('features.list_title3')}</strong>
        {$_('features.list3')}
      </li>
      <li>
        <strong>{$_('features.list_title4')}</strong>
        {$_('features.list4')}
      </li>
    </ul>
    <h2>{$_('credits_help.header')}</h2>
    <p>
      <img src="assets/volunteers.png" class="volunteers" alt="not actually the volunteers" />
    </p>
    <p>
      {@html $_('credits_help.text1')}
    </p>
    <p>
      {@html $_('credits_help.text3')}
    </p>
    <p>
      {@html $_('credits_help.list4.text1')}
      {@html $_('credits_help.list4.text2')}
      {@html $_('credits_help.list4.text3')}
    </p>
    <p>
      {@html $_('credits_help.text4')}
      {@html $_('credits_help.text5')}
    </p>
    <h2>{$_('other_things.header')}</h2>
    <ul>
      <li>{@html $_('other_things.list1')}</li>
      <li>{@html $_('other_things.list2')}</li>
    </ul>
    <div class="dialog-footer">
      <button class="ui-button primary" type="button" onclick={close}>{$_('close')}</button>
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 10000000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .dialog {
    position: relative;
    bottom: 7%;
    color: var(--sl-color-gray-700);
    background: var(--sl-color-white);
    border-radius: 12px;
    padding: 1.25em 1.5em 1em;
    max-width: min(92vw, 720px);
    max-height: 80vh;
    overflow: auto;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.75em;
  }

  .ui-button {
    border: 0;
    border-radius: 8px;
    padding: 0.45em 0.9em;
    background: var(--sl-color-gray-200);
    color: var(--sl-color-black);
    font-weight: 600;
    cursor: pointer;
  }

  .ui-button.primary {
    background: var(--sl-color-primary-600);
    color: var(--sl-color-primary-text);
  }

  .volunteers {
    float: right;
    width: 35%;
    padding: 1em;
  }

  a {
    color: var(--sl-color-primary-600);
  }

  a:visited {
    color: var(--sl-color-primary-600);
  }

  .appstore-logo {
    width: 95%;
  }

  .appstoreLogo {
    margin: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .appstore-logo.about {
    flex: 50%;
  }

  .dialog-overview {
    line-height: 1.5em;
  }
</style>
