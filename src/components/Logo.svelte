<script>
  import logo from "../../public/assets/logo.svg";
  import About from "./About.svelte";
  import { _ } from "svelte-i18n";

  let showAbout = false;

  function toggleAbout() {
    if (!showAbout) {
      showAbout = true;
    } else {
      showAbout = false;
    }
  }
</script>

<style>
  .logo-wrapper {
    z-index: 10;
    position: absolute;
    top: max(env(safe-area-inset-top), 1vh);
    left: 0;
    margin-left: 0;
    padding: 0;

    border-top-right-radius: 15px;
    border-bottom-right-radius: 15px;
    background-color: var(--sl-color-white);

    font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto,
      Helvetica Neue, Arial, Noto Sans, sans-serif, Apple Color Emoji,
      Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji;

    color: var(--sl-color-black);
    text-align: left;
    height: 6vh;
    vertical-align: top;
    border: 1px solid var(--sl-color-gray-50);
    background-color: var(--sl-color-white);
    min-height: 32px;
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
  .link {
    color: var(--sl-color-primary-600);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }

  a:visited{
    color: var(--sl-color-primary-600);
    cursor: pointer;
  }

  a {
    color: var(--sl-color-primary-600);
  }

  .logo{
    height: 90%;
    float: left;
    padding: 0.5vh 1vh 1vh;
  }
</style>

<div class="logo-wrapper">
  <img
    src={logo}
    alt="meteocool"
    class="logo"
    />
  <div class="name">{$_("url")}</div>
  <!-- <div class="claim">Get the App! <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623">iOS</a> & <a href="
https://play.google.com/store/apps/details?id=com.meteocool">Android</a>
    </div> -->
  <div class="claim">
    <span on:click={() => toggleAbout()} class="link">{$_("about")}</span> |
    <a href="https://discord.gg/5y4xDVpwxc" target="_blank"
      >{$_("join_community")}</a>
  </div>
  {#if showAbout}
    <About on:close={() => toggleAbout()} />
  {/if}
</div>
