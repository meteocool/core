<script lang="ts">
import logo from "../assets/logo.svg";
// Both sheets load when first opened; neither is part of looking at the map.
const loadAbout = () => import("./About.svelte");
const loadSettings = () => import("./SettingsDialog.svelte");
import Lazy from "./Lazy.svelte";
import Icon from "./Icon.svelte";
import { faGear } from "@fortawesome/free-solid-svg-icons/faGear";
import { _ } from "svelte-i18n";
import { logoStyle, sharedActiveCap } from "../stores";
import { capabilityEnabled } from "../caps/enabled";

export let layerManager;

let showAbout = false;
let showSettings = false;

function toggleAbout() {
  showAbout = !showAbout;
}

/** From the settings' About row: one sheet at a time. */
function openAbout() {
  showSettings = false;
  showAbout = true;
}

/**
 * The logo is the way home: back to the rain radar from whichever map is up,
 * as the apps' logo does. About is the first row of the settings now.
 */
function goToMainMap() {
  if ($sharedActiveCap === "radar" || !capabilityEnabled("radar")) return;
  layerManager.setTarget("radar", "map");
}

/*
 * The maps a reader may not know how to leave: neither has the radar's tray
 * or player to say where they are. Under the logo, as the logo is what the
 * hint is about, so only where there is a logo, which $logoStyle already
 * decides (not in the apps, not in a screenshot).
 */
$: hinted = $sharedActiveCap === "precipTypes" || $sharedActiveCap === "lightning";
/** Tapped or clicked: what the primary pointer is, as the hint words it. */
const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;

function toggleSettings() {
  showSettings = !showSettings;
}
</script>

<style>
  /* Top-left glass capsule, on the same top line as the Live pill and the
     switcher disc, and the same 44px height as that disc. The material itself
     comes from .glass/.glass-pill in src/glass.css; this is shape, layout and
     the press response.

     The capsule is one control with one job: it goes back to the main map.
     Liquid Glass carries no links or secondary text of its own; About is the
     settings' first row. */
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
      color var(--mc-motion-fast),
      transform var(--mc-motion-fast) var(--mc-ease);
  }
  /* The discs' hover: the fill strengthens and the ink goes accent (here
     the wordmark, there the glyph). */
  .logo-pill:hover { background: var(--mc-glass-fill-strong); color: var(--mc-accent); }
  .logo-pill:active { transform: scale(var(--mc-press)); }
  .logo-pill:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

  /* Settings, beside it: a disc like the switcher's on the right. Only the
     web gets one: in the apps these settings live in the native settings
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

  /* Under the logo on the maps that are not the main one, pointing up at it. */
  .hint {
    position: absolute;
    z-index: var(--mc-z-chrome);
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + 10px);
    left: var(--mc-gutter);
    max-width: min(260px, calc(100vw - 2 * var(--mc-gutter)));
    padding: 8px 12px;
    border-radius: var(--mc-radius-inner);
    color: var(--mc-text);
    font: 500 13px/1.3 var(--mc-font);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .hint::before {
    content: "";
    position: absolute;
    top: -5px;
    left: 17px;
    width: 10px;
    height: 10px;
    background: inherit;
    border-left: 1px solid var(--mc-glass-edge);
    border-top: 1px solid var(--mc-glass-edge);
    transform: rotate(45deg);
  }
  .hint:hover { background: var(--mc-glass-fill-strong); }
  .hint:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }

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
      aria-label={$_("main_map")}
      title={$_("main_map")}
      on:click={goToMainMap}>
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
  {#if hinted}
    <button type="button" class="hint glass" on:click={goToMainMap}>
      {$_(touch ? "main_map_hint_tap" : "main_map_hint_click")}
    </button>
  {/if}
  {#if showAbout}
    <Lazy load={loadAbout} floating let:module>
      <svelte:component this={module.default} on:close={toggleAbout} />
    </Lazy>
  {/if}
  {#if showSettings}
    <Lazy load={loadSettings} floating let:module>
      <svelte:component this={module.default} on:close={toggleSettings} on:about={openAbout} />
    </Lazy>
  {/if}
{/if}
