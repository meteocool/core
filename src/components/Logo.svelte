<script lang="ts">
import logo from "../assets/logo.svg";
import About from "./About.svelte";
import SettingsDialog from "./SettingsDialog.svelte";
import Icon from "./Icon.svelte";
import { faGear } from "@fortawesome/free-solid-svg-icons/faGear";
import { _ } from "svelte-i18n";
import { logoStyle } from "../stores";

let showAbout = false;
let showSettings = false;

function toggleAbout() {
  showAbout = !showAbout;
}

function toggleSettings() {
  showSettings = !showSettings;
}
</script>

<style>
  /* Top-left glass capsule, on the same top line as the Live pill and the
     switcher disc, and the same 44px height as that disc. The material itself
     comes from .glass/.glass-pill in src/glass.css -- this is shape, layout and
     the press response.

     The capsule is one control with one job: it opens About. Liquid Glass
     carries no links or secondary text of its own; anything to read or follow
     belongs in the sheet the capsule opens. */
  .top-left {
    z-index: var(--mc-z-chrome);
    position: absolute;
    top: var(--mc-top-stack);
    left: var(--mc-gutter);
    display: flex;
    gap: 8px;
  }

  .logo-pill {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--mc-control-lg);
    padding: 0 14px 0 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--mc-motion-fast),
      transform var(--mc-motion-fast) var(--mc-ease);
  }
  .logo-pill:hover { background: var(--mc-glass-fill-strong); }
  .logo-pill:active { transform: scale(var(--mc-press)); }
  .logo-pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  /* Settings, beside it: a disc like the switcher's on the right. Only the
     web gets one -- in the apps these settings live in the native settings
     screen, which pushes them in through window.settings.injectSettings(). */
  .settings-disc {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: var(--mc-control-lg);
    height: var(--mc-control-lg);
    padding: 0;
    color: var(--mc-text);
    font-size: 19px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--mc-motion-fast),
      color var(--mc-motion-fast),
      transform var(--mc-motion-fast) var(--mc-ease);
  }
  .settings-disc:hover { background: var(--mc-glass-fill-strong); color: var(--mc-accent); }
  .settings-disc:active { transform: scale(var(--mc-press)); }
  .settings-disc:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  .logo {
    height: 28px;
    width: 28px;
    flex: none;
    /* the white raindrop in logo.svg needs an edge on light glass over a bright map */
    filter: drop-shadow(0 0.5px 1px rgba(0, 0, 0, 0.28));
  }

  .name {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  /* Phone: the wordmark would run into the centred Live pill, so the capsule
     becomes a 44px disc mirroring the switcher disc on the right. */
  @media only screen and (max-width: 620px) {
    .logo-pill {
      width: var(--mc-control-lg);
      padding: 0;
      justify-content: center;
    }
    .name { display: none; }
  }
</style>

{#if $logoStyle === "full"}
  <div class="top-left">
    <button
      type="button"
      class="logo-pill glass glass-pill"
      aria-label={$_("about")}
      on:click={toggleAbout}>
      <img src={logo} alt="meteocool" class="logo" />
      <span class="name">{$_("url")}</span>
    </button>
    <button
      type="button"
      class="settings-disc glass glass-pill"
      aria-label={$_("settings.title")}
      title={$_("settings.title")}
      on:click={toggleSettings}>
      <Icon icon={faGear} />
    </button>
  </div>
  {#if showAbout}
    <About on:close={toggleAbout} />
  {/if}
  {#if showSettings}
    <SettingsDialog on:close={toggleSettings} />
  {/if}
{/if}
