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
 *
 * A flight's link (`?fly=`, lib/studio/flightLink.ts) skips both: the page
 * goes straight onto the 3D map at the link's start, and Studio takes off
 * from there as soon as the storms are in, with nothing of these words or of
 * the plan on the way. Once that flight is over, its part of the address
 * goes, so a reload is this page again rather than the same flight.
 *
 * The page is the flight's menu: the menus' music plays on it from the
 * reader's first click or key (lib/studio/flight/soundtrack.ts), with a
 * switch for it, and on through the plan, until the flight takes it over.
 * And while the reader reads, everything the flight needs is loaded
 * (lib/studio/flight/preload.ts): the button says how far that is, and a
 * press before it is done waits for it.
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
import { flightRequest, studioFlying, studioOpen } from "../../lib/studio/store";
import { withoutFlightLink } from "../../lib/studio/flightLink";
import type { FlightStart } from "../../lib/studio/flightLink";
import type Cells3DCapability from "../../caps/Cells3DCapability";
import { cells3dFailed, sharedActiveCap } from "../../stores";
import { DeviceDetect } from "../../lib/DeviceDetect";
import SoundSwitch from "../studio/flight/SoundSwitch.svelte";
import { flightLoad, loadMenuMusic, preloadFlight, shareOf } from "../../lib/studio/flight/preload";
import { claimMenuMusic } from "../../lib/studio/flight/soundtrack";
import { curtainDown, lift, lower } from "../../lib/curtain";

export let layerManager: LayerManager;

/**
 * Where the radar map is: meteocool.com on the web; in the apps, their own
 * page without `#meteoair`, which loads it again as the app's map
 * (lib/studio/flightPage.ts). A link to the website would take the app's
 * view off to it.
 */
const mapHref = DeviceDetect.isApp() ? `${window.location.pathname}${window.location.search}` : "https://meteocool.com/";
/** The flight the page's link asks for, if it asks for one. */
export let link: FlightStart | null = null;

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

/* The menus' music at once: it is what is heard first. The flight's code is
   Studio's, fetched when Studio opens, and its aircraft and music are large;
   here the flight is what the page is for, so all of it is loaded while the
   reader reads, once the page is up and the radar has had its first moments. */
const LOAD_AFTER_MS = 600;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
onMount(() => {
  if (!offered) return;
  void loadMenuMusic();
  requestAnimationFrame(() => {
    loadTimer = setTimeout(() => preloadFlight().catch(() => undefined), LOAD_AFTER_MS);
  });
});
onDestroy(() => {
  if (loadTimer !== null) clearTimeout(loadTimer);
});

/** Whether the reader has pressed the button before the flight was loaded: it goes once it is. */
let waiting = false;
$: percent = Math.floor(shareOf($flightLoad) * 100);
$: if (waiting && $flightLoad.state === "ready") {
  waiting = false;
  aboard();
}

function board(): void {
  if (offered) layerManager.setTarget("cells3d", MAP_TARGET);
}

// The 3D map did not come up: no plan will lift the black, so its veil is shown at once.
$: if ($cells3dFailed) lift();

/** On board through black, as a simulator goes from its menu to the next: the plan lifts it once it is up. */
function aboard(): void {
  if (curtainDown()) return;
  void lower().then(board);
}

/** The button: on board if everything is loaded, else once it is (and another try after a failure). */
function plan(): void {
  if (!offered) return;
  if ($flightLoad.state === "ready") {
    aboard();
    return;
  }
  waiting = true;
  preloadFlight().catch(() => {
    waiting = false;
  });
}

/** Whether the page is on its link's flight: from opening until that flight is over, or never got off. */
let linked = Boolean(link && offered);

/** The link's part of the address taken off, now that its flight is over. */
function unlink(): void {
  if (!linked) return;
  linked = false;
  const search = withoutFlightLink(window.location.search);
  if (search !== window.location.search) {
    history.replaceState(history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
  }
}

if (link && linked) {
  // The 3D map comes up looking at the start, and Studio flies from it.
  flightRequest.set({ start: link });
  (layerManager.getCapability("cells3d") as Cells3DCapability | undefined)
    ?.setCamera({ lat: link.lat, lon: link.lon, zoom: 8, pitch: 60, bearing: 0 });
  board();
}

/* On this page the 3D map is the flight's and nothing else: it comes up in
   Studio, whichever way the page got onto it, and goes when Studio does. */
onDestroy(sharedActiveCap.subscribe((cap) => {
  if (cap === "cells3d") openStudio();
}));
onDestroy(studioOpen.subscribe((open) => {
  if (open) return;
  unlink();
  if (get(sharedActiveCap) === "cells3d") layerManager.setTarget("radar", MAP_TARGET);
}));
let flew = false;
onDestroy(studioFlying.subscribe((flying) => {
  if (flying) flew = true;
  else if (flew) unlink();
}));

$: aloft = $sharedActiveCap === "cells3d" || linked;

/* The theme plays while the page is a menu: its words, or the plan over the 3D map; not under a flight, nor while a link's flight boards. */
let release: (() => void) | null = null;
$: menu = offered && !$studioFlying && !linked;
$: if (menu && !release) release = claimMenuMusic();
$: if (!menu && release) {
  release();
  release = null;
}
onDestroy(() => release?.());

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
        <a href={mapHref}>{$_("studio.flight.page.by")}</a>
      </p>
      <div class="tools">
      {#if offered}
        <SoundSwitch />
      {/if}
      {#if fullscreenSupported()}
        <button type="button" class="screen" on:click={toggleFullscreen} aria-pressed={$fullscreen}
          title={$_($fullscreen ? "studio.flight.page.fullscreen_exit" : "studio.flight.page.fullscreen")}>
          <Icon icon={$fullscreen ? faCompress : faExpand} />
          <span>{$_($fullscreen ? "studio.flight.page.fullscreen_exit" : "studio.flight.page.fullscreen")}</span>
        </button>
      {/if}
      </div>
    </header>

    <main class="mc-selectable">
      <h1>{$_("studio.flight.page.headline")}</h1>
      <p class="lede">{$_("studio.flight.page.lede")}</p>

      {#if offered}
        <div class="go">
          <button type="button" class="board" class:waiting on:click={plan} aria-busy={waiting}
            title={$flightLoad.state === "ready" || $flightLoad.state === "failed" ? undefined
              : $_("studio.flight.page.loading_title", { values: { percent } })}>
            <Icon icon={faPlaneDeparture} />
            {waiting ? $_("studio.flight.page.loading", { values: { percent } }) : $_("studio.flight.page.board")}
            {#if $flightLoad.state === "loading"}
              <span class="load" style:width={`${percent}%`} aria-hidden="true"></span>
            {/if}
          </button>
          <p class="hint">{$_(byTouch ? "studio.flight.page.hint_touch" : "studio.flight.page.hint")}</p>
          <p class="status" class:failed={$flightLoad.state === "failed"} role="status">
            {#if $flightLoad.state === "loading"}
              <span class="spinner" aria-hidden="true"></span>{$_("studio.flight.page.loading", { values: { percent } })}
            {:else if $flightLoad.state === "ready"}
              {$_("studio.flight.page.ready")}
            {:else if $flightLoad.state === "failed"}
              {$_("studio.flight.page.failed")}
              <button type="button" class="retry" on:click={plan}>{$_("studio.flight.page.retry")}</button>
            {/if}
          </p>
        </div>
      {:else}
        <div class="go">
          <p class="hint grounded">{$_("studio.flight.page.unavailable")}</p>
          <a class="board quiet" href={mapHref}>{$_("studio.flight.page.open_map")}</a>
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
      <a href={mapHref}>{$_("studio.flight.page.map")}</a>
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
    padding: clamp(18px, 3.2cqh, 36px) clamp(20px, 4.5cqw, 72px);
    /* Clear of a notch on either side: a phone's, on its side. */
    padding-left: max(clamp(20px, 4.5cqw, 72px), calc(var(--mc-safe-left) + 12px));
    padding-right: max(clamp(20px, 4.5cqw, 72px), calc(var(--mc-safe-right) + 12px));
    /* And clear of the status bar, a phone's clock and all. */
    padding-top: max(clamp(18px, 3.2cqh, 36px), calc(var(--mc-safe-top) + 8px));
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
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
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
    font-size: clamp(34px, 4.6cqw, 60px);
    font-weight: 750;
    line-height: 1.04;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  .lede {
    margin: 18px 0 0;
    color: var(--ink-2);
    font-size: clamp(15px, 1.25vw, 18px);
    font-size: clamp(15px, 1.25cqw, 18px);
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
  /* What is loaded so far, along the button's foot; pressed early, it waits for the rest. */
  .board { position: relative; overflow: hidden; }
  .board .load {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 4px;
    background: rgba(26, 18, 5, 0.55);
    transition: width 0.2s ease;
  }
  .board.waiting { cursor: progress; }
  .status {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 18px;
    margin: 0;
    color: var(--ink-3);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .status.failed { color: #ffb4ae; }
  .status .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(244, 246, 248, 0.3);
    border-top-color: var(--mc-orange);
    border-radius: 50%;
    animation: landing-turn 0.9s linear infinite;
  }
  @keyframes landing-turn { to { transform: rotate(360deg); } }
  .retry {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 12.5px/1 var(--mc-font);
    text-decoration: underline;
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .status .spinner { animation: none; }
    .board .load { transition: none; }
  }
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
     stand at the bottom with the weather above them. The page's own size,
     which is not the screen's where it is drawn on its side (lib/sideways.ts). */
  @container mc-frame (max-width: 760px) {
    .landing {
      padding: 16px 18px calc(18px + var(--mc-safe-bottom));
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
  @container mc-frame (max-height: 620px) {
    ul { display: none; }
  }
</style>
