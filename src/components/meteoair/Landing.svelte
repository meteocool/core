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
 * Everything else the flight needs is large (lib/studio/flight/preload.ts),
 * so it is loaded only once the reader takes off, and a reader on a phone's
 * data is told how large first.
 *
 * On a live build (meteocool.com, next) with no thunderstorm on the radar
 * (lib/studio/flight/fallback.ts), the flight is the demo's recorded storm
 * instead, and the page says so: its button loads the page again on the
 * demo's weather (src/weatherSource.ts), and on to the plan. The reader may
 * keep the live weather all the same.
 *
 * In the apps the page is their meteoair mode: a way back to the app's map
 * where the website has its footer.
 */
import logo from "../../assets/logo.svg";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";
import { fade } from "svelte/transition";
import { _ } from "svelte-i18n";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import { faBolt } from "@fortawesome/free-solid-svg-icons/faBolt";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";
import { faFlask } from "@fortawesome/free-solid-svg-icons/faFlask";
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
import { FLIGHT_BYTES, loadMenuMusic } from "../../lib/studio/flight/preload";
import { liveSkyWorthFlying } from "../../lib/studio/flight/fallback";
import { demoFallbackBuild, demoWeather, WEATHER_KEY, weatherChoice } from "../../weatherSource";
import { radarMapHref } from "../../lib/studio/flightPage";
import { claimMenuMusic } from "../../lib/studio/flight/soundtrack";
import { curtainDown, lift, lower } from "../../lib/curtain";

export let layerManager: LayerManager;

/** Inside one of the apps, where the page is their meteoair mode. */
const inApp = DeviceDetect.isApp();
/**
 * Where the radar map is: meteocool.com on the web; in the apps, their own
 * page without `#meteoair`, on its thunderstorms, which loads it again as the
 * app's map (lib/studio/flightPage.ts). A link to the website would take the
 * app's view off to it.
 */
const mapHref = inApp ? radarMapHref() : "https://meteocool.com/";
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

/* The menus' music at once: it is what is heard first, and small. The rest
   (the flight's code, its aircraft and its music) waits for take-off. */
onMount(() => {
  if (offered) void loadMenuMusic();
});

/** The page loaded again with the weather set as asked, `board` to go on to the plan at once. */
function reloadWith(weather: "demo" | "live" | null, board: boolean): void {
  const url = new URL(window.location.href);
  if (weather) url.searchParams.set(WEATHER_KEY, weather);
  else url.searchParams.delete(WEATHER_KEY);
  if (board) url.searchParams.set(BOARD_KEY, "1");
  else url.searchParams.delete(BOARD_KEY);
  window.location.assign(url.href);
}

/** On the address, to go straight on to the plan once the page has loaded again on the demo's weather. */
const BOARD_KEY = "board";

/**
 * Whether the flight will be the demo's storm: where the page already is on
 * it, or where this live build's radar has no thunderstorm to fly at (asked
 * once the page is up). Not where the reader has asked for the live weather,
 * nor for a link's flight, which is the link's.
 */
let toDemo = demoWeather;
if (demoFallbackBuild && !demoWeather && offered && !link && weatherChoice(window.location) !== "live") {
  void liveSkyWorthFlying().then((worth) => {
    if (worth === false) toDemo = true;
  });
}

type Connection = { type?: string; saveData?: boolean };
const connection = (navigator as Navigator & { connection?: Connection }).connection;
/**
 * Whether the reader may be paying for what the flight loads: a phone's data
 * where the browser says so (Chrome on Android), or asks to save it; where
 * it says nothing (Safari, Firefox), any touch screen, which is most often a
 * phone's.
 */
const metered = connection?.type !== undefined || connection?.saveData
  ? connection.type === "cellular" || connection.saveData === true
  : byTouch;
const megabytes = Math.round(FLIGHT_BYTES / 1e6);

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

/**
 * The button: on board to the plan. Nothing more is loaded yet: what the
 * flight needs comes once the reader takes off, with how far along it is.
 * To the demo's storm through black, by loading the page again on its weather.
 */
function plan(): void {
  if (!offered) return;
  if (toDemo && !demoWeather) {
    if (curtainDown()) return;
    void lower().then(() => reloadWith("demo", true));
    return;
  }
  aboard();
}

/** The live weather after all: the page loaded again on it where it is on the demo's, the demo forgotten where it was only planned. */
function keepLive(): void {
  if (demoWeather) reloadWith("live", false);
  else toDemo = false;
}

// Back on the demo's weather from the button: on to the plan, and the address without the errand.
if (demoWeather && offered && new URLSearchParams(window.location.search).has(BOARD_KEY)) {
  const url = new URL(window.location.href);
  url.searchParams.delete(BOARD_KEY);
  history.replaceState(history.state, "", url.href);
  board();
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

/** The way through it, a step at a time: the last one says how it is flown, by touch or keys. */
const steps = [
  { title: "find", text: "find_text" },
  { title: "plan", text: "plan_text" },
  { title: "fly", text: byTouch ? "fly_text_touch" : "fly_text" },
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
      <!-- The way back to the radar map, in the website as in the apps: meteocool's, and looking it.
           On a narrow screen it is by the way in instead, where there is room for its words. -->
      <a class="home top" href={mapHref}>
        <Icon icon={faArrowLeft} />
        <img src={logo} alt="" />
        <span>{$_("studio.flight.plan.back")}</span>
      </a>
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
      <p class="eyebrow">
        <span class="tag"><Icon icon={faFlask} /> {$_("studio.flight.page.demo_tag")}</span>
      </p>
      <h1>{$_("studio.flight.page.headline")}</h1>
      <p class="lede">{$_("studio.flight.page.lede")}</p>

      {#if offered}
        <div class="go">
          <button type="button" class="board" on:click={plan}>
            <Icon icon={faPlaneDeparture} />
            {$_("studio.flight.page.board")}
          </button>
          <a class="home by-board" href={mapHref}>
            <Icon icon={faArrowLeft} />
            <img src={logo} alt="" />
            <span>{$_("studio.flight.plan.back")}</span>
          </a>
          <!-- Where the steps below have no room: the first of them, and how a phone flies. -->
          <p class="hint">
            {$_("studio.flight.page.find_text")}
            {#if byTouch}{$_("studio.flight.page.fly_text_touch")}{/if}
          </p>
          <p class="note">{$_("studio.flight.page.demo")}</p>
          {#if metered}
            <p class="note data">{$_("studio.flight.page.data", { values: { mb: megabytes } })}</p>
          {/if}
        </div>
      {:else}
        <div class="go">
          <p class="hint grounded">{$_("studio.flight.page.unavailable")}</p>
          <a class="board quiet" href={mapHref}>{$_("studio.flight.page.open_map")}</a>
        </div>
      {/if}

      {#if offered && toDemo}
        <p class="note replay" role="status" transition:fade={{ duration: 180 }}>
          <span class="tag"><Icon icon={faBolt} /> {$_("studio.flight.page.replay_tag")}</span>
          {$_(demoWeather ? "studio.flight.page.replay_on" : "studio.flight.page.replay")}
          <button type="button" class="link" on:click={keepLive}>{$_("studio.flight.page.replay_live")}</button>
        </p>
      {/if}

      {#if offered}
        <ol>
          {#each steps as step (step.title)}
            <li>
              <h2>{$_(`studio.flight.page.${step.title}`)}</h2>
              <p>{$_(`studio.flight.page.${step.text}`)}</p>
            </li>
          {/each}
        </ol>
      {/if}
    </main>

    {#if !inApp}
      <footer>
        <a href={mapHref}>{$_("studio.flight.page.map")}</a>
        <a href="imprint.html">{$_("studio.flight.page.imprint")}</a>
        <a href="privacy.html">{$_("studio.flight.page.privacy")}</a>
      </footer>
    {/if}
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
    /* Never wider than the screen for what is in it. */
    grid-template-columns: minmax(0, 1fr);
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
  .home {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 18px 0 14px;
    border-radius: var(--mc-radius-pill);
    background: #0a84ff;
    color: #fff;
    font: 650 15px/1 var(--mc-font);
    text-decoration: none;
    white-space: nowrap;
    box-shadow: 0 8px 24px rgba(10, 132, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    transition: transform 0.12s ease, background-color 0.12s ease;
  }
  .home img { width: 26px; height: 26px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3)); }
  .home :global(svg) { width: 13px; height: 13px; }
  .home:hover { background: #409cff; transform: translateY(-1px); }
  .home:active { transform: translateY(0) scale(0.98); }
  .home:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .home.by-board { display: none; }
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
  .eyebrow { margin: 0 0 14px; }
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
  .note {
    margin: 0;
    color: var(--ink-3);
    font-size: 12.5px;
    line-height: 1.45;
  }
  /* The small print under the button. */
  .go .note { flex-basis: 100%; }
  .note.data { color: #ffd08a; }
  /* The demo's storm in place of the live radar's: said where the button is, in the button's colour. */
  .note.replay {
    margin-top: 18px;
    max-width: 34rem;
    color: var(--ink-2);
    pointer-events: auto;
  }
  .note.replay .tag { background: rgba(255, 214, 10, 0.18); color: #ffd60a; }
  .link {
    margin: 0 0 0 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: 6px;
    padding: 2px 8px;
    border-radius: var(--mc-radius-pill);
    background: rgba(255, 149, 0, 0.18);
    color: var(--mc-orange);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tag :global(svg) { width: 10px; height: 10px; }
  .board.quiet {
    background: rgba(255, 255, 255, 0.14);
    color: var(--ink);
    box-shadow: none;
  }
  .board.quiet:hover { background: rgba(255, 255, 255, 0.22); }
  .hint {
    display: none;
    flex-basis: 100%;
    margin: 0;
    color: var(--ink-3);
    font-size: 13px;
    line-height: 1.4;
  }
  .hint.grounded { display: block; color: var(--ink-2); font-size: 14px; }

  ol {
    display: grid;
    gap: 16px;
    margin: 40px 0 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
  }
  li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 0 14px;
    align-items: start;
    counter-increment: step;
  }
  li::before {
    content: counter(step);
    grid-row: span 2;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(255, 149, 0, 0.18);
    color: var(--mc-orange);
    font: 700 12px/1 var(--mc-font);
  }
  h2 {
    margin: 2px 0 0;
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
    .home.top { display: none; }
    .home.by-board { display: inline-flex; height: 52px; padding: 0 22px 0 18px; font-size: 16px; }
    .hint { display: block; order: 1; }
    .go .note { order: 2; }
    ol { display: none; }
    .eyebrow { margin-bottom: 10px; }
    .lede { margin-top: 12px; }
    .go { margin-top: 20px; }
  }
  @container mc-frame (max-height: 620px) {
    .hint { display: block; order: 1; }
    .go .note { order: 2; }
    ol { display: none; }
  }
  /* The smallest phones: the button by the way in says whose the page is. */
  @container mc-frame (max-width: 400px) {
    .mark a { display: none; }
  }
</style>
