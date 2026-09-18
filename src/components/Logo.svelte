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
  /* Top-left glass capsule on the same top line as the Latest pill and the
     switcher disc. Web only, so the blur is ~230x40px at most. */
  .logo-wrapper {
    z-index: var(--mc-z-chrome);
    position: absolute;
    top: var(--mc-top-stack);
    left: var(--mc-gutter);
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    min-height: 0;
    padding: 0 12px 0 4px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
    color: var(--mc-text);
    font-family: var(--mc-font);
    text-align: left;
  }

  .logo {
    height: 30px;
    width: 30px;
    float: none;
    padding: 0;
    margin: 0;
    /* the white raindrop in logo.svg needs an edge on light glass over a bright map */
    filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.28));
  }

  .menu {
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.15;
  }

  .name {
    display: block;
    margin: 0;
    padding: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .claim {
    font-size: 11px;
    font-weight: 500;
    color: var(--mc-text-2);
  }

  .link,
  a,
  a:visited {
    color: var(--mc-accent);
    cursor: pointer;
    font-weight: 500;
  }
  .link:hover,
  a:hover {
    text-decoration: underline;
  }

  .logo-button {
    display: contents;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  /* Phone: a 40px disc holding the drop; tap slides the wordmark out. */
  @media only screen and (max-width: 620px) {
    .logo-wrapper {
      max-width: 40px;
      padding: 0 4px;
      overflow: hidden;
      transition: max-width 180ms var(--mc-ease), padding 180ms var(--mc-ease);
    }
    .logo-wrapper.menu-open {
      max-width: 88vw;
      padding: 0 12px 0 4px;
    }
    .logo-button {
      cursor: pointer;
    }
    .menu {
      opacity: 0;
      max-width: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: opacity 180ms var(--mc-ease), max-width 180ms var(--mc-ease);
    }
    .logo-wrapper.menu-open .menu {
      opacity: 1;
      max-width: 80vw;
    }
    .name {
      font-size: 13px;
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
  </div>
  {#if showAbout}
    <About on:close={() => toggleAbout()} />
  {/if}
{/if}
