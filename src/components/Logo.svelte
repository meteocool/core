<script lang="ts">
import logo from "../assets/logo.svg";
import About from "./About.svelte";
import { _ } from "svelte-i18n";
import { logoStyle } from "../stores";

let showAbout = false;

/**
 * On a phone the wordmark and its two links run into the "Latest" pill, so
 * below 620px the block collapses to the icon alone and the rest slides out
 * when it is tapped. On desktop `menuOpen` is simply ignored.
 */
let menuOpen = false;

function toggleMenu() {
  menuOpen = !menuOpen;
}

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

  .logo-button {
    display: contents;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  @media only screen and (max-width: 620px) {
    .logo-wrapper {
      height: auto;
      min-height: 0;
      padding: 2px 0;
      max-width: 42px;
      overflow: hidden;
      transition: max-width 180ms ease;
    }

    .logo-wrapper.menu-open {
      max-width: 88vw;
    }

    .logo-button {
      cursor: pointer;
    }

    .logo {
      height: 30px;
      padding: 2px 6px;
    }

    .menu {
      display: inline-block;
      opacity: 0;
      max-width: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: opacity 180ms ease, max-width 180ms ease;
    }

    .logo-wrapper.menu-open .menu {
      opacity: 1;
      max-width: 80vw;
    }

    .name {
      font-size: 13px;
      padding-right: 4px;
    }
  }
</style>

{#if $logoStyle === "full"}
  <div class="logo-wrapper" class:menu-open={menuOpen}>
    <button type="button" class="logo-button" on:click={toggleMenu} aria-expanded={menuOpen}>
      <img
              src={logo}
              alt="meteocool"
              class="logo"
      />
    </button>
    <div class="menu">
    <div class="name">{$_("url")}</div>
    <!-- <div class="claim">Get the App! <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623">iOS</a> & <a href="
  https://play.google.com/store/apps/details?id=com.meteocool">Android</a>
      </div> -->
    <div class="claim">
      <span on:click={() => toggleAbout()} class="link">{$_("about")}</span> |
      <a href="https://discord.gg/5y4xDVpwxc" target="_blank"
      >{$_("join_community")}</a>
    </div>
    </div>
    {#if showAbout}
      <About on:close={() => toggleAbout()} />
    {/if}
  </div>
{/if}
