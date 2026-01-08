<script>
  const logo = '/assets/logo.svg'
  import About from './About.svelte'
  import { _ } from 'svelte-i18n'
  import { logoStyle } from '../stores'

  let showAbout = $state(false)
  let showMenu = $state(false)

  function toggleAbout() {
    showAbout = !showAbout
  }

  function toggleMenu() {
    showMenu = !showMenu
  }
</script>

{#if $logoStyle === 'full'}
  <div class="logo-wrapper" class:menu-open={showMenu}>
    <button
      class="logo-button"
      type="button"
      aria-label="Toggle meteocool menu"
      aria-expanded={showMenu}
      aria-controls="logo-menu"
      onclick={toggleMenu}
      onkeydown={(e) => e.key === 'Enter' && toggleMenu()}
    >
      <img src={logo} alt="meteocool" class="logo" />
    </button>
    <div class="menu" id="logo-menu">
      <div class="name">{$_('url')}</div>
      <!-- <div class="claim">Get the App! <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623">iOS</a> & <a href="
    https://play.google.com/store/apps/details?id=com.meteocool">Android</a>
        </div> -->
      <div class="claim">
        <span onclick={() => toggleAbout()} class="link" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggleAbout()}
          >{$_('about')}</span
        >
        |
        <a href="https://discord.gg/5y4xDVpwxc" target="_blank">{$_('join_community')}</a>
      </div>
    </div>
    {#if showAbout}
      <About onclose={() => toggleAbout()} />
    {/if}
  </div>
{/if}

<style>
  .logo-wrapper {
    z-index: 10;
    position: absolute;
    top: max(env(safe-area-inset-top), 1vh);
    left: 0;
    margin-left: 0;
    padding: 0 0.4em 0 0;

    border-top-right-radius: 15px;
    border-bottom-right-radius: 15px;
    background-color: var(--sl-color-white);

    font-family:
      -apple-system,
      BlinkMacSystemFont,
      Segoe UI,
      Roboto,
      Helvetica Neue,
      Arial,
      Noto Sans,
      sans-serif,
      Apple Color Emoji,
      Segoe UI Emoji,
      Segoe UI Symbol,
      Noto Color Emoji;

    color: var(--sl-color-black);
    text-align: left;
    height: 6vh;
    vertical-align: top;
    border: 1px solid var(--sl-color-gray-50);
    background-color: var(--sl-color-white);
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }

  .logo-button {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }

  .name {
    display: inline-block;
    vertical-align: top;
    margin-right: 10px;
    padding-top: 0px;
    padding-right: 6px;
    font-size: max(2.9vh, 15px);
  }

  .claim {
    font-size: max(1.5vh, 8px);
  }

  .menu {
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  .link {
    color: var(--sl-color-primary-600);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }

  a:visited {
    color: var(--sl-color-primary-600);
    cursor: pointer;
  }

  a {
    color: var(--sl-color-primary-600);
  }

  .logo {
    height: 90%;
    float: left;
    padding: 0.5vh 1vh 1vh;
  }

  @media only screen and (max-width: 620px) {
    .logo-wrapper {
      height: auto;
      min-height: 40px;
      padding: 0.2em 0.4em 0.2em 0.2em;
      border-top-right-radius: 12px;
      border-bottom-right-radius: 12px;
    }

    .logo {
      height: 30px;
      padding: 0.2em 0.35em;
    }

    .name {
      font-size: 13px;
      margin-right: 0;
      padding-right: 0;
    }

    .claim {
      font-size: 11px;
    }

    .menu {
      opacity: 0;
      max-height: 0;
      max-width: 0;
      overflow: hidden;
      transform: translateY(-4px);
      pointer-events: none;
      transition:
        opacity 160ms ease,
        transform 160ms ease,
        max-height 160ms ease,
        max-width 160ms ease;
    }

    .logo-wrapper.menu-open .menu {
      opacity: 1;
      max-height: 120px;
      max-width: 220px;
      transform: translateY(0);
      pointer-events: auto;
    }
  }
</style>
