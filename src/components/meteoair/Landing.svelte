<script lang="ts">
/**
 * The flight's own page (meteoair.html): what it says over the radar map,
 * and the way into the flight.
 *
 * The map underneath is the app's own, with nothing over it: it can be moved,
 * and where it is looking is where the flight's plan looks for its storms.
 * The button puts the page on the 3D map in Studio, which on this page opens
 * straight on the plan (components/studio/Studio.svelte); the plan put away,
 * the page is back on the radar and these words.
 */
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import { fade } from "svelte/transition";
import { _ } from "svelte-i18n";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import { faBolt } from "@fortawesome/free-solid-svg-icons/faBolt";
import { faGauge } from "@fortawesome/free-solid-svg-icons/faGauge";
import { faGamepad } from "@fortawesome/free-solid-svg-icons/faGamepad";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import Icon from "../Icon.svelte";
import type { LayerManager } from "../../lib/LayerManager";
import { fullscreen, fullscreenSupported, toggleFullscreen } from "../../lib/fullscreen";
import { closeStudio, openStudio } from "../../lib/studio/session";
import { touchFirst } from "../../lib/studio/flight/touch";
import { studioOpen } from "../../lib/studio/store";
import { cells3dFailed, sharedActiveCap } from "../../stores";

export let layerManager: LayerManager;

/** The element every map is drawn into; see Map.svelte. */
const MAP_TARGET = "map";

/**
 * Whether there is a flight to offer: in a build with the 3D map, on a phone
 * as on a desktop. Studio's tools are a desktop's (`studioOffered`); the
 * flight has controls of its own for a touch screen.
 */
const offered = Boolean(layerManager.getCapability("cells3d"));
/** Whether it will be flown by touch: the page says how, in place of the keys. */
const byTouch = touchFirst();

/* The flight's code is Studio's, fetched when Studio opens; here that is
   what the page is for, so it is fetched while the reader reads, and the
   plan comes up as soon as the 3D map has. */
onMount(() => {
  if (offered) void import("../studio/Studio.svelte").catch(() => undefined);
});

function board(): void {
  if (offered) layerManager.setTarget("cells3d", MAP_TARGET);
}

/* On this page the 3D map is the flight's and nothing else: it comes up in
   Studio, whichever way the page got onto it, and goes when Studio does. */
onDestroy(sharedActiveCap.subscribe((cap) => {
  if (cap === "cells3d") openStudio();
}));
onDestroy(studioOpen.subscribe((open) => {
  if (!open && get(sharedActiveCap) === "cells3d") layerManager.setTarget("radar", MAP_TARGET);
}));

$: aloft = $sharedActiveCap === "cells3d";

const FEATURES = [
  { icon: faBolt, title: "live", text: "live_text" },
  { icon: faGauge, title: "deck", text: "deck_text" },
  { icon: faGamepad, title: "controls", text: "controls_text" },
] as const;
</script>

{#if !aloft}
  <div class="landing" transition:fade={{ duration: 220 }}>
    <header>
      <p class="mark">
        <Icon icon={faPlaneDeparture} />
        <span>meteoair</span>
        <a href="https://meteocool.com/">{$_("studio.flight.page.by")}</a>
      </p>
      {#if fullscreenSupported()}
        <button type="button" class="screen" on:click={toggleFullscreen} aria-pressed={$fullscreen}
          title={$_($fullscreen ? "studio.flight.page.fullscreen_exit" : "studio.flight.page.fullscreen")}>
          <Icon icon={$fullscreen ? faCompress : faExpand} />
          <span>{$_($fullscreen ? "studio.flight.page.fullscreen_exit" : "studio.flight.page.fullscreen")}</span>
        </button>
      {/if}
    </header>

    <main class="mc-selectable">
      <h1>{$_("studio.flight.page.headline")}</h1>
      <p class="lede">{$_("studio.flight.page.lede")}</p>

      {#if offered}
        <div class="go">
          <button type="button" class="board" on:click={board}>
            <Icon icon={faPlaneDeparture} /> {$_("studio.flight.page.board")}
          </button>
          <p class="hint">{$_(byTouch ? "studio.flight.page.hint_touch" : "studio.flight.page.hint")}</p>
        </div>
      {:else}
        <div class="go">
          <p class="hint grounded">{$_("studio.flight.page.unavailable")}</p>
          <a class="board quiet" href="https://meteocool.com/">{$_("studio.flight.page.open_map")}</a>
        </div>
      {/if}

      <ul>
        {#each FEATURES as feature (feature.title)}
          <li>
            <Icon icon={feature.icon} />
            <div>
              <h2>{$_(`studio.flight.page.${feature.title}`)}</h2>
              <p>{$_(`studio.flight.page.${feature.text}`)}</p>
            </div>
          </li>
        {/each}
      </ul>
    </main>

    <footer>
      <a href="https://meteocool.com/">{$_("studio.flight.page.map")}</a>
      <a href="imprint.html">{$_("studio.flight.page.imprint")}</a>
      <a href="privacy.html">{$_("studio.flight.page.privacy")}</a>
    </footer>
  </div>
{:else if $cells3dFailed}
  <!-- The 3D map did not come up: its veil offers another try, this the way back. -->
  <button type="button" class="back" on:click={closeStudio}>
    <Icon icon={faArrowLeft} /> {$_("studio.flight.page.back")}
  </button>
{/if}

<style>
  /* Over the map and its credits' side of the page only in shade: the words
     stand on a dark wash down the left, whatever the basemap, and the map is
     the page's to the right of it. Nothing here takes the pointer but what
     is pressed, so the map moves under the rest. */
  .landing {
    --ink: #f4f6f8;
    --ink-2: rgba(244, 246, 248, 0.78);
    --ink-3: rgba(244, 246, 248, 0.6);
    position: fixed;
    inset: 0;
    z-index: var(--mc-z-pill);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    box-sizing: border-box;
    padding: clamp(18px, 3.2vh, 36px) clamp(20px, 4.5vw, 72px);
    background: linear-gradient(90deg, rgba(7, 11, 17, 0.92) 0%, rgba(7, 11, 17, 0.84) 30%, rgba(7, 11, 17, 0.4) 50%, rgba(7, 11, 17, 0) 68%);
    color: var(--ink);
    font-family: var(--mc-font);
    pointer-events: none;
  }
  /* The map's own names, softened under the words so the two are not read at once. */
  .landing::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    -webkit-backdrop-filter: blur(7px);
    backdrop-filter: blur(7px);
    -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 34%, transparent 56%);
    mask-image: linear-gradient(90deg, #000 0%, #000 34%, transparent 56%);
  }
  .landing :is(a, button) { pointer-events: auto; }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .screen {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: var(--mc-radius-pill);
    background: rgba(7, 11, 17, 0.62);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    color: var(--ink);
    font: 600 13px/1 var(--mc-font);
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .screen:hover { background: rgba(30, 38, 50, 0.8); }
  .screen:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .mark {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    font-size: 15px;
    color: var(--mc-orange);
  }
  .mark span {
    color: var(--ink);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .mark a {
    color: var(--ink-3);
    font-size: 13px;
    text-decoration: none;
  }
  .mark a:hover { color: var(--ink); }

  main {
    align-self: center;
    width: min(540px, 100%);
    pointer-events: auto;
    /* The words are read, not dragged; the map is everything beside them. */
  }
  h1 {
    margin: 0;
    font-size: clamp(34px, 4.6vw, 60px);
    font-weight: 750;
    line-height: 1.04;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  .lede {
    margin: 18px 0 0;
    color: var(--ink-2);
    font-size: clamp(15px, 1.25vw, 18px);
    line-height: 1.5;
    text-wrap: pretty;
  }

  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    margin-top: 28px;
  }
  .board {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 26px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-orange);
    color: #1a1205;
    font: 650 17px/1 var(--mc-font);
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(255, 149, 0, 0.28);
    transition: transform 0.12s ease, background-color 0.12s ease;
  }
  .board:hover { background: color-mix(in srgb, var(--mc-orange) 86%, #fff); transform: translateY(-1px); }
  .board:active { transform: translateY(0) scale(0.98); }
  .board:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .board.quiet {
    background: rgba(255, 255, 255, 0.14);
    color: var(--ink);
    box-shadow: none;
  }
  .board.quiet:hover { background: rgba(255, 255, 255, 0.22); }
  .hint {
    flex: 1 1 200px;
    margin: 0;
    color: var(--ink-3);
    font-size: 13px;
    line-height: 1.4;
  }
  .hint.grounded { flex-basis: 100%; color: var(--ink-2); font-size: 14px; }

  ul {
    display: grid;
    gap: 16px;
    margin: 40px 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 14px;
    align-items: start;
    color: var(--mc-orange);
    font-size: 16px;
  }
  li :global(svg) { margin-top: 2px; }
  h2 {
    margin: 0;
    color: var(--ink);
    font-size: 15px;
    font-weight: 650;
  }
  li p {
    margin: 3px 0 0;
    color: var(--ink-3);
    font-size: 13.5px;
    line-height: 1.45;
  }

  footer {
    display: flex;
    gap: 18px;
    font-size: 12.5px;
  }
  footer a { color: var(--ink-3); text-decoration: none; }
  footer a:hover { color: var(--ink); }

  .back {
    position: fixed;
    top: calc(var(--mc-safe-top) + 16px);
    left: 16px;
    z-index: var(--mc-z-panel);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: rgba(7, 11, 17, 0.78);
    color: #f4f6f8;
    font: 600 14px/1 var(--mc-font);
    cursor: pointer;
  }

  /* A narrow window: the wash comes up from the foot instead, and the words
     stand at the bottom with the weather above them. */
  @media (max-width: 760px) {
    .landing {
      padding: 16px 18px calc(18px + env(safe-area-inset-bottom, 0px));
      background:
        linear-gradient(180deg, rgba(7, 11, 17, 0.7) 0%, rgba(7, 11, 17, 0) 14%),
        linear-gradient(0deg, rgba(7, 11, 17, 0.95) 0%, rgba(7, 11, 17, 0.88) 46%, rgba(7, 11, 17, 0.25) 74%, rgba(7, 11, 17, 0) 100%);
    }
    .landing::before {
      -webkit-mask-image: linear-gradient(0deg, #000 0%, #000 44%, transparent 66%);
      mask-image: linear-gradient(0deg, #000 0%, #000 44%, transparent 66%);
    }
    main { align-self: end; padding-bottom: 18px; }
    .screen { width: 38px; padding: 0; justify-content: center; }
    .screen span { display: none; }
    ul { display: none; }
    .lede { margin-top: 12px; }
    .go { margin-top: 20px; }
  }
  @media (max-height: 620px) {
    ul { display: none; }
  }
</style>
