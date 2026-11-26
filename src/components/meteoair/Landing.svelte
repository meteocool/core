<script lang="ts">
/**
 * The flight's own page (meteoair.html): what it says over the radar map,
 * and the way into the flight.
 *
 * The map underneath is the app's own, with nothing over it: it is put on
 * the radar's rain and can be moved. Where to fly, and at which storm, is
 * the plan's to ask; the page says nothing of the map being a way to choose.
 *
 * The reader's own flights of the last two hours are drawn on that map
 * (layers/flightTracks.ts). One clicked opens the plan as that flight took
 * off, to change and fly again (`flightReplan`), and the plan says so.
 * The button puts the page on the 3D map in Studio, which on this page opens
 * straight on the plan (components/studio/Studio.svelte); the plan put away,
 * the page is back on the radar and these words.
 *
 * A flight's link (`?fly=`, lib/studio/flightLink.ts) skips both: the page
 * goes straight onto the 3D map at the link's start, and Studio takes off
 * from there as soon as the storms are in, with nothing of these words or of
 * the plan on the way. A link with a past moment in it (`pastSkyAt`) first
 * opens the map in a past window ending on that moment (lib/archive.ts), so
 * the storms that come in, the radar under them and the strikes are its;
 * where the archive no longer keeps it, the flight is in the radar's now,
 * and the page says so. Once that flight is over, its part of the address
 * goes, so a reload is this page again rather than the same flight; the
 * window stays for the plan it ends on, and goes with Studio. The plan says
 * when it is flown and changes it (lib/studio/flight/when.ts); this page has
 * no word of the archive, nor its frame round the map.
 *
 * The page is the flight's menu: the menus' music streams and plays on it
 * from the reader's first click or key (lib/studio/flight/soundtrack.ts),
 * with a switch for it, and on through the plan, until the flight takes it
 * over; nothing of it is fetched before that click, nor with the sound off.
 * Everything else the flight needs is large (lib/studio/flight/preload.ts),
 * so none of it is loaded on this page: the plan fetches the aircraft its
 * preview turns, take-off the rest, and a reader on a phone's data is told
 * how large first.
 *
 * With no thunderstorm on the radar now (lib/studio/flight/fallback.ts),
 * the flight is the strongest storm of the history instead
 * (lib/studio/flight/stormOfHistory.ts), and the page says so: its button
 * opens the past window on that storm and goes on to the plan, with nothing
 * loaded again. The reader may keep the live weather all the same. A link
 * from before, flown in the demo's recorded storm, is still on the demo's
 * weather (src/weatherSource.ts).
 *
 * In the apps the page is their meteoair mode: a way back to the app's map
 * where the website has its footer.
 */
import logo from "../../assets/logo.svg";
import { onDestroy, onMount, tick } from "svelte";
import { get } from "svelte/store";
import { fade } from "svelte/transition";
import { _ } from "svelte-i18n";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import { faBolt } from "@fortawesome/free-solid-svg-icons/faBolt";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons/faArrowLeft";
import { faFlask } from "@fortawesome/free-solid-svg-icons/faFlask";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import { faCloudBolt } from "@fortawesome/free-solid-svg-icons/faCloudBolt";
import { faCloudShowersHeavy } from "@fortawesome/free-solid-svg-icons/faCloudShowersHeavy";
import { faPlaneArrival } from "@fortawesome/free-solid-svg-icons/faPlaneArrival";
import { faHourglassHalf } from "@fortawesome/free-solid-svg-icons/faHourglassHalf";
import { faRoute } from "@fortawesome/free-solid-svg-icons/faRoute";
import { faGaugeHigh } from "@fortawesome/free-solid-svg-icons/faGaugeHigh";
import { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub";
import { faApple } from "@fortawesome/free-brands-svg-icons/faApple";
import { faAndroid } from "@fortawesome/free-brands-svg-icons/faAndroid";
import Icon from "../Icon.svelte";
import type { LayerManager } from "../../lib/LayerManager";
import { fullscreen, fullscreenSupported, toggleFullscreen } from "../../lib/fullscreen";
import { closeStudio, openStudio } from "../../lib/studio/session";
import { touchFirst } from "../../lib/studio/flight/touch";
import { flightReplan, flightRequest, studioFlying, studioOpen } from "../../lib/studio/store";
import { flightTracks } from "../../lib/studio/flightTracks";
import { pastSkyAt, withoutFlightLink } from "../../lib/studio/flightLink";
import type { FlightStart } from "../../lib/studio/flightLink";
import type Cells3DCapability from "../../caps/Cells3DCapability";
import { archiveStep, archiveWindow, cells3dFailed, sharedActiveCap } from "../../stores";
import { BOARD_KEY, openPastAt, readBoarding } from "../../lib/studio/flight/when";
import { openShowcase, showcase } from "../../lib/showcase";
import { reportNotice } from "../../lib/Toast";
import { DeviceDetect } from "../../lib/DeviceDetect";
import SoundSwitch from "../studio/flight/SoundSwitch.svelte";
import { FLIGHT_BYTES } from "../../lib/studio/flight/preload";
import { liveSkyWorthFlying } from "../../lib/studio/flight/fallback";
import { demoWeather, WEATHER_KEY, weatherChoice } from "../../weatherSource";
import { findHistoryStorm, historyStormBuild } from "../../lib/studio/flight/stormOfHistory";
import { openHistoryStorm } from "../../lib/studio/flight/when";
import { radarMapHref } from "../../lib/studio/flightPage";
import { claimMenuMusic } from "../../lib/studio/flight/soundtrack";
import { curtainDown, lift, lower } from "../../lib/curtain";
import { rainBoxes, rainView } from "../../lib/studio/flight/rainView";
import DragPan from "ol/interaction/DragPan";
import { noModifierKeys, primaryAction } from "ol/events/condition";
import type OlMap from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";

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

/** The page loaded again with the weather set as asked, its errand to the plan forgotten. */
function reloadWith(weather: "demo" | "live" | null): void {
  const url = new URL(window.location.href);
  if (weather) url.searchParams.set(WEATHER_KEY, weather);
  else url.searchParams.delete(WEATHER_KEY);
  url.searchParams.delete(BOARD_KEY);
  window.location.assign(url.href);
}

/* Loaded again onto or off the recorded storm, from the button or the plan
   (lib/studio/flight/when.ts): on to the plan, in the past moment asked for
   where one was, and the address without the errand. */
const boarding = link ? null : readBoarding(window.location.search);

/**
 * Whether the flight will be a recorded storm: the demo's, where a link put
 * the page on it, or the history's strongest, where the radar has no
 * thunderstorm to fly at now and the history has one (asked once the page
 * is up). Not where the reader has asked for the live weather, nor on the
 * demo's own site, whose weather is its recording, nor for a link's flight,
 * which is the link's, nor for a plan in a past moment, whose sky is not the
 * radar's now.
 */
let toStorm = demoWeather;
if (
  historyStormBuild && !demoWeather && offered && !link && boarding?.at == null
  && weatherChoice(window.location) !== "live"
) {
  void liveSkyWorthFlying().then(async (worth) => {
    if (worth === false && await findHistoryStorm()) toStorm = true;
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

/**
 * Where the app keeps its map element while the page has it in among its
 * words (`placeMap`); null while it is home. Declared before `board`, which
 * a link's flight calls as the page is made.
 */
let mapHome: { parent: Node; next: Node | null } | null = null;
/** The map's own pans while it is in among the words, and the two-finger one in their place (`cooperate`). Declared here for the same reason. */
let cooperating: { map: OlMap; pans: DragPan[]; mine: DragPan } | null = null;

function board(): void {
  if (!offered) return;
  // Full screen again before the 3D map is made in it, at the size it flies at.
  homeMap();
  layerManager.setTarget("cells3d", MAP_TARGET);
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
 * To the history's storm through black: its past window opened, the 3D map
 * looking at it.
 */
function plan(): void {
  if (!offered) return;
  // A new flight, whatever was last asked for again.
  flightReplan.set(null);
  if (toStorm && !demoWeather) {
    if (curtainDown()) return;
    void lower().then(async () => {
      const storm = await openHistoryStorm();
      if (storm) {
        (layerManager.getCapability("cells3d") as Cells3DCapability | undefined)
          ?.setCamera({ lat: storm.lat, lon: storm.lon, zoom: 8, pitch: 60, bearing: 0 });
      }
      board();
    });
    return;
  }
  aboard();
}

/** The live weather after all: the page loaded again on it where a link put it on the demo's, the storm forgotten where it was only planned. */
function keepLive(): void {
  if (demoWeather) reloadWith("live");
  else toStorm = false;
}

if (boarding) {
  const url = new URL(window.location.href);
  url.searchParams.delete(BOARD_KEY);
  history.replaceState(history.state, "", url.href);
}
/** The past moment the plan is boarded in, once its window is open (or refused); null where there is none. */
let boardedPast: Promise<unknown> | null = null;
if (boarding && offered) {
  const at = boarding.at;
  if (at === null) board();
  else {
    boardedPast = openPastAt(at).then((opened) => {
      if (!opened) reportNotice(get(_)("studio.flight.share.past_gone"));
      board();
    });
  }
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

/** The link's flight: the 3D map comes up looking at its start, and Studio flies from it. */
function takeOff(start: FlightStart): void {
  flightRequest.set({ start });
  (layerManager.getCapability("cells3d") as Cells3DCapability | undefined)
    ?.setCamera({ lat: start.lat, lon: start.lon, zoom: 8, pitch: 60, bearing: 0 });
  board();
}

if (link && linked) {
  const start = link;
  const at = pastSkyAt(start, Date.now() / 1000);
  if (at === null && showcase) {
    // The demo's storm has no now: a flight in it without a moment of its
    // own is flown in the whole of it (lib/showcase.ts).
    void openShowcase().then(() => { if (linked) takeOff(start); });
  } else if (at === null) takeOff(start);
  else {
    // Before the 3D map comes up, so it never asks for the radar's now.
    void openPastAt(at).then((opened) => {
      if (!opened) reportNotice(get(_)("studio.flight.share.past_gone"));
      // Gone before the archive answered: the reader left the page's flight.
      if (linked) takeOff(start);
    });
  }
}

// On the demo's storm the plan is made in it, from the page's first moment (lib/showcase.ts).
const showcaseOpened = showcase && !link ? openShowcase() : null;

let landingElement: HTMLElement | undefined;
let mainElement: HTMLElement | undefined;
let windowElement: HTMLElement | undefined;

/**
 * On a small screen the map is not behind the words but in among them: the
 * app's own map element, moved into its place on the page (`.window`, under
 * the way in) and scrolled with the rest, and back where the app keeps it,
 * filling the screen, for the 3D map and the flight, on a wide window, and
 * once the page goes. In among the words one finger scrolls the page,
 * over the map as anywhere, and two move the map (`cooperate`).
 */
function mapElement(): HTMLElement | null {
  return document.getElementById(MAP_TARGET);
}

/**
 * The map in among the words pans under two fingers only, as a map set in a
 * page does: its pan swapped for one that lets a single finger go, which
 * OpenLayers then leaves to the browser to scroll the page with (the
 * viewport's `touch-action: pan-x pan-y`). A mouse drags it as ever. A
 * pinch zooms it as ever; a second finger is what makes the pan the map's.
 */
function cooperate(): void {
  if (cooperating) return;
  const element = mapElement();
  const map = layerManager.maps.find((candidate) => candidate.getTargetElement() === element);
  if (!map) return;
  const pans = map.getInteractions().getArray().filter((interaction): interaction is DragPan => interaction instanceof DragPan);
  const mine: DragPan = new DragPan({
    condition: (event: MapBrowserEvent) => (event.originalEvent as PointerEvent).pointerType === "touch"
      ? mine.getPointerCount() > 1
      : noModifierKeys(event) && primaryAction(event),
  });
  for (const pan of pans) map.removeInteraction(pan);
  map.addInteraction(mine);
  cooperating = { map, pans, mine };
}

function stopCooperating(): void {
  if (!cooperating) return;
  const { map, pans, mine } = cooperating;
  cooperating = null;
  map.removeInteraction(mine);
  for (const pan of pans) map.addInteraction(pan);
}

/** Said over the map for a moment when one finger is dragged across it, which scrolls the page instead. */
let twoFingers = false;
let twoFingersTimer: ReturnType<typeof setTimeout> | null = null;
function oneFinger(event: TouchEvent): void {
  if (event.touches.length !== 1) {
    twoFingers = false;
    return;
  }
  twoFingers = true;
  if (twoFingersTimer !== null) clearTimeout(twoFingersTimer);
  twoFingersTimer = setTimeout(() => { twoFingers = false; }, 1400);
}
onDestroy(() => { if (twoFingersTimer !== null) clearTimeout(twoFingersTimer); });

/** The map back where the app keeps it. */
function homeMap(): void {
  stopCooperating();
  const map = mapElement();
  if (!map || !mapHome) return;
  const { parent, next } = mapHome;
  mapHome = null;
  parent.insertBefore(map, next?.parentNode === parent ? next : null);
}

/** The map into the page where the page has a place for it (a small screen) and is up; home otherwise. */
function placeMap(): void {
  const map = mapElement();
  const wanted = Boolean(windowElement && !aloft && windowElement.getClientRects().length > 0);
  if (!map || !windowElement || !wanted) {
    homeMap();
    return;
  }
  if (map.parentNode !== windowElement) {
    if (!mapHome && map.parentNode) mapHome = { parent: map.parentNode, next: map.nextSibling };
    windowElement.appendChild(map);
  }
  cooperate();
}

/** The map's place on the page: followed as the page goes from wide to small and back. */
function mapWindow(node: HTMLElement) {
  windowElement = node;
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(placeMap);
  observer?.observe(node);
  node.addEventListener("touchmove", oneFinger, { passive: true });
  placeMap();
  return {
    destroy() {
      observer?.disconnect();
      node.removeEventListener("touchmove", oneFinger);
      windowElement = undefined;
      homeMap();
    },
  };
}
onDestroy(homeMap);

/**
 * The part of the screen the map shows beside the words, px: on a small
 * screen its own place on the page, on a wide one everything right of them.
 */
function mapRegion(): { left: number; top: number; right: number; bottom: number } | null {
  if (!landingElement || !mainElement) return null;
  const frame = landingElement.getBoundingClientRect();
  if (windowElement && windowElement.offsetHeight > 0) {
    const place = windowElement.getBoundingClientRect();
    return { left: place.left, top: place.top, right: place.right, bottom: place.bottom };
  }
  const words = mainElement.getBoundingClientRect();
  return { left: Math.min(words.right + 24, frame.right - 160), top: frame.top, right: frame.right, bottom: frame.bottom };
}

/**
 * The page opens on rain: the map moved to where the radar has it, close
 * enough that it fills at least half of what the words leave of the map
 * (lib/studio/flight/rainView.ts). Not once the reader has moved the map
 * themselves, nor for a link's flight, which looks where it says.
 */
async function lookAtRain(): Promise<void> {
  const map = layerManager.getCapability(layerManager.currentCap ?? "radar")?.getMap();
  if (!map || layerManager.currentCap === "cells3d") return;
  let moved = false;
  const theirs = () => { moved = true; };
  const viewport = map.getViewport();
  viewport.addEventListener("pointerdown", theirs, { once: true });
  viewport.addEventListener("wheel", theirs, { once: true, passive: true });
  // The rain of the moment the page opens in: the past one's once its window is open.
  await showcaseOpened;
  await boardedPast;
  const boxes = await rainBoxes(get(archiveStep));
  await tick();
  const region = mapRegion();
  if (moved || aloft || !region || !boxes.length) return;
  const found = rainView(boxes, region.right - region.left, region.bottom - region.top);
  if (!found) return;
  // The rain's middle at the region's middle: the map's centre is off it by as much.
  const whole = viewport.getBoundingClientRect();
  const dx = (region.left + region.right) / 2 - (whole.left + whole.width / 2);
  const dy = (region.top + region.bottom) / 2 - (whole.top + whole.height / 2);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.getView().animate({
    center: [found.x - dx * found.resolution, found.y + dy * found.resolution],
    resolution: found.resolution,
    duration: still ? 0 : 1200,
  });
}
onMount(() => {
  if (!link) void lookAtRain();
});

/* On this page the 3D map is the flight's and nothing else: it comes up in
   Studio, whichever way the page got onto it, and goes when Studio does. */
onDestroy(sharedActiveCap.subscribe((cap) => {
  if (cap === "cells3d") openStudio();
}));
/* One of the reader's own flights, clicked on the map: on board to its plan, the 3D map looking at where it took off. */
onDestroy(flightReplan.subscribe((again) => {
  if (!again || !offered || $sharedActiveCap === "cells3d" || linked) return;
  if (curtainDown()) {
    flightReplan.set(null);
    return;
  }
  (layerManager.getCapability("cells3d") as Cells3DCapability | undefined)
    ?.setCamera({ lat: again.start.lat, lon: again.start.lon, zoom: 8, pitch: 60, bearing: again.start.heading ?? 0 });
  aboard();
}));
/** Whether Studio has been open: not before it first is, which a flight in a past window waits for the archive to reach. */
let studioWasOpen = false;
onDestroy(studioOpen.subscribe((open) => {
  if (open) studioWasOpen = true;
  if (open || !studioWasOpen) return;
  unlink();
  flightReplan.set(null);
  // Back on this page, which is the radar's now: a past window, from a link or the plan, goes. The recorded storm has no now.
  if (!showcase && get(archiveWindow)) archiveWindow.set(null);
  if (get(sharedActiveCap) === "cells3d") layerManager.setTarget("radar", MAP_TARGET);
}));
let flew = false;
onDestroy(studioFlying.subscribe((flying) => {
  if (flying) flew = true;
  else if (flew) unlink();
}));

$: aloft = $sharedActiveCap === "cells3d" || linked;
// Before the page goes for the 3D map: the map is home before its place on the page is.
$: if (aloft) homeMap();

/* The theme plays while the page is a menu: its words, or the plan over the 3D map; not under a flight, nor while a link's flight boards. */
let release: (() => void) | null = null;
$: menu = offered && !$studioFlying && !linked;
$: if (menu && !release) release = claimMenuMusic();
$: if (!menu && release) {
  release();
  release = null;
}
onDestroy(() => release?.());

/** Under the way in: what to go and do in the storm, and how an airliner wants to be flown. */
const guides = [
  { title: "try_title", items: [
    { key: "try_through", icon: faCloudBolt },
    { key: "try_under", icon: faCloudShowersHeavy },
    { key: "try_land", icon: faPlaneArrival },
  ] },
  { title: "fly_title", items: [
    { key: "fly_time", icon: faHourglassHalf },
    { key: "fly_route", icon: faRoute },
    { key: "fly_control", icon: faGaugeHigh },
  ] },
] as const;
</script>

{#if !aloft}
  <div class="landing" transition:fade={{ duration: 220 }} bind:this={landingElement}>
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

    <div class="sheet">
    <main class="mc-selectable" bind:this={mainElement}>
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
          {#if $flightTracks.length}
            <!-- The reader's own flights are on the map, in this colour, and each is a way in. -->
            <p class="recent"><span class="trace" aria-hidden="true"></span>{$_("studio.flight.page.tracks")}</p>
          {/if}
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

      {#if offered && toStorm}
        <p class="note replay" role="status" transition:fade={{ duration: 180 }}>
          <span class="tag"><Icon icon={faBolt} /> {$_("studio.flight.page.replay_tag")}</span>
          {$_(demoWeather ? "studio.flight.page.replay_on" : "studio.flight.page.replay")}
          <button type="button" class="link" on:click={keepLive}>{$_("studio.flight.page.replay_live")}</button>
        </p>
      {/if}

      <!-- On a small screen, the map: in among the words, under the way in, and scrolled with them. -->
      <div class="window" use:mapWindow>
        {#if twoFingers}
          <p class="two-fingers" transition:fade={{ duration: 160 }}>{$_("studio.flight.page.two_fingers")}</p>
        {/if}
      </div>

      {#if offered}
        <!-- Below the way in: what the flight is for, what to try in it and how to fly it. -->
        <div class="brief">
          <!-- Why the page is here: the map and the watching, the distance, the flight. -->
          <div class="mission">
            <p>{$_("studio.flight.page.mission_then")} {$_("studio.flight.page.mission_watched")}</p>
            <p>
              <!-- A word between asterisks is said with weight. -->
              {#each $_("studio.flight.page.mission_far").split("*") as bit, index (index)}{#if index % 2}<em>{bit}</em>{:else}{bit}{/if}{/each}
            </p>
            <p class="now">{$_("studio.flight.page.mission_now")} {$_("studio.flight.page.mission_seat")}</p>
          </div>
          <div class="guide">
            {#each guides as guide (guide.title)}
              <section>
                <h2>{$_(`studio.flight.page.${guide.title}`)}</h2>
                <ul>
                  {#each guide.items as item (item.key)}
                    <li>
                      <Icon icon={item.icon} />
                      <p><strong>{$_(`studio.flight.page.${item.key}`)}</strong> {$_(`studio.flight.page.${item.key}_text`)}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
          <p class="note small">
            {$_(byTouch ? "studio.flight.page.controls_touch" : "studio.flight.page.controls")}
            {$_("studio.flight.page.demo")}
          </p>
        </div>
      {/if}
    </main>

    {#if !inApp}
      <footer>
        <nav class="links">
          <a href={mapHref}>{$_("studio.flight.page.map")}</a>
          <a href="imprint.html">{$_("studio.flight.page.imprint")}</a>
          <a href="privacy.html">{$_("studio.flight.page.privacy")}</a>
        </nav>
        <!-- meteocool's apps and its code. -->
        <nav class="elsewhere">
          <a href="https://github.com/meteocool/core#meteocool" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub">
            <Icon icon={faGithub} />
          </a>
          <a href="https://itunes.apple.com/app/meteocool-rain-radar/id1438364623" target="_blank" rel="noopener"
            aria-label={$_("chrome.alt.app_store")} title={$_("chrome.alt.app_store")}>
            <Icon icon={faApple} />
          </a>
          <a href="https://play.google.com/store/apps/details?id=com.meteocool" target="_blank" rel="noopener"
            aria-label={$_("chrome.alt.play_store")} title={$_("chrome.alt.play_store")}>
            <Icon icon={faAndroid} />
          </a>
        </nav>
      </footer>
    {/if}
    </div>
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
     the page's to the right of it. The wash is as wide as the words at
     least (--words), however narrow the window: no word is read off the
     map's own names or its rain. Nothing here takes the pointer but what is
     pressed, so the map moves under the rest. */
  .landing {
    --gutter: max(clamp(20px, 4.5cqw, 72px), calc(var(--mc-safe-left) + 12px));
    --words: calc(var(--gutter) + 540px);
    --ink: #f4f6f8;
    --ink-2: rgba(244, 246, 248, 0.78);
    --ink-3: rgba(244, 246, 248, 0.6);
    position: fixed;
    inset: 0;
    z-index: var(--mc-z-pill);
    display: grid;
    /* Rows as tall as their words at least: a short window scrolls them rather than cutting them off. */
    grid-template-rows: auto 1fr auto;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
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
    background: linear-gradient(90deg,
      rgba(7, 11, 17, 0.94) 0%,
      rgba(7, 11, 17, 0.88) max(30%, calc(var(--words) - 40px)),
      rgba(7, 11, 17, 0.5) max(50%, calc(var(--words) + 70px)),
      rgba(7, 11, 17, 0) max(68%, calc(var(--words) + 210px)));
    /* And each word with a shade of its own, for the rain the wash lets through. */
    text-shadow: 0 1px 2px rgba(7, 11, 17, 0.85), 0 0 14px rgba(7, 11, 17, 0.6);
    color: var(--ink);
    font-family: var(--mc-font);
    pointer-events: none;
  }
  /* The map's own names, softened under the words so the two are not read at once. */
  .landing::before {
    content: "";
    /* Over the screen however far the words have scrolled. */
    position: fixed;
    inset: 0;
    z-index: -1;
    -webkit-backdrop-filter: blur(9px);
    backdrop-filter: blur(9px);
    -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 max(34%, calc(var(--words) + 10px)), transparent max(56%, calc(var(--words) + 140px)));
    mask-image: linear-gradient(90deg, #000 0%, #000 max(34%, calc(var(--words) + 10px)), transparent max(56%, calc(var(--words) + 140px)));
  }
  /* Wide: the words and the footer are rows of the page's own grid. */
  .sheet { display: contents; }
  .window { display: none; }
  /* Global: the music's switch is a button of its own component, which a scoped selector would miss. */
  .landing :global(:is(a, button)) { pointer-events: auto; }

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
    box-shadow: 0 8px 24px rgba(10, 132, 255, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.28);
    transition: transform 0.12s ease, background-color 0.12s ease;
  }
  .home img { width: 26px; height: 26px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3)); }
  .home :global(svg) { width: 13px; height: 13px; }
  .home:hover { background: #409cff; transform: translateY(-1px); }
  .home:active { transform: translateY(0) scale(0.98); }
  .home:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }

  /* The two ways off the page, each with a glow of its own colour: a halo behind it that breathes, slowly and barely. */
  .home, .board:not(.quiet) { position: relative; isolation: isolate; }
  .home { --glow: #0a84ff; }
  .board { --glow: var(--mc-orange); }
  .home::before, .board:not(.quiet)::before {
    content: "";
    position: absolute;
    inset: -4px;
    z-index: -1;
    border-radius: inherit;
    background: var(--glow);
    filter: blur(14px);
    opacity: 0.42;
    pointer-events: none;
    animation: breathe 5.2s ease-in-out infinite alternate;
  }
  @keyframes breathe {
    from { opacity: 0.3; transform: scale(0.97); }
    to { opacity: 0.55; transform: scale(1.03); }
  }
  @media (prefers-reduced-motion: reduce) {
    .home::before, .board:not(.quiet)::before { animation: none; }
  }
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
    font-size: clamp(34px, 4.6vw, 56px);
    font-size: clamp(34px, 4.6cqw, 56px);
    font-weight: 750;
    line-height: 1.04;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  /* The headline's second line: what the page is, in a breath. */
  .lede {
    margin: 14px 0 0;
    color: var(--ink);
    font-size: clamp(17px, 1.45vw, 21px);
    font-size: clamp(17px, 1.45cqw, 21px);
    font-weight: 500;
    line-height: 1.4;
    text-wrap: balance;
  }

  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    margin-top: 24px;
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
  .board, .home { text-shadow: none; }
  .board:hover { background: color-mix(in srgb, var(--mc-orange) 86%, #fff); transform: translateY(-1px); }
  .board:active { transform: translateY(0) scale(0.98); }
  .board:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .note {
    margin: 0;
    color: var(--ink-3);
    font-size: 13px;
    line-height: 1.4;
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
  /* Beside the way in where there is room, under it where there is not. */
  .recent {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1 1 220px;
    margin: 0;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 1.35;
  }
  /* A stroke of the tracks' own magenta, as the map draws them. */
  .trace {
    flex: none;
    width: 18px;
    height: 3px;
    border-radius: 2px;
    background: #ec40d6;
    box-shadow: 0 0 8px rgba(236, 64, 214, 0.7);
  }
  .hint {
    flex-basis: 100%;
    margin: 0;
    color: var(--ink-2);
    font-size: 13.5px;
    line-height: 1.4;
  }
  .hint.grounded { font-size: 14px; }

  /* Past the way in, and set off from it: read by whoever wants more before they fly. */
  .brief {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .mission { display: grid; gap: 4px; }
  .mission p {
    margin: 0;
    color: var(--ink-2);
    font-size: 15px;
    font-weight: 400;
    line-height: 1.45;
    text-wrap: balance;
  }
  /* The last line is the page's offer: set a little apart, and brighter. */
  .mission .now { margin-top: 5px; color: var(--ink); font-weight: 600; }
  /* The page's sizes, from the headline down: lede 17–21, subheadings 16, words 15, lists 14, small print 13. */
  /* Side by side where there is room for two, one under the other on a phone. */
  .guide {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px 28px;
    margin-top: 16px;
  }
  h2 {
    margin: 0 0 10px;
    color: var(--ink);
    font-size: 16px;
    font-weight: 650;
    line-height: 1.3;
    letter-spacing: -0.01em;
  }
  ul {
    display: grid;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 0 10px;
    align-items: start;
  }
  li :global(svg) {
    width: 14px;
    height: 14px;
    margin-top: 3px;
    color: var(--mc-orange);
  }
  li p {
    margin: 0;
    color: var(--ink-2);
    font-size: 14px;
    line-height: 1.45;
  }
  li strong { color: var(--ink); font-weight: 650; }
  .note.small { margin-top: 12px; }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 22px;
    font-size: 12.5px;
  }
  footer nav { display: flex; align-items: center; }
  .links { gap: 18px; }
  .links a { color: var(--ink-3); text-decoration: none; }
  .links a:hover { color: var(--ink); }
  .elsewhere { gap: 8px; }
  .elsewhere a {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    color: var(--ink-2);
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .elsewhere a:hover { background: rgba(255, 255, 255, 0.16); color: var(--ink); }
  .elsewhere a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .elsewhere :global(svg) { width: 16px; height: 16px; }

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

  /* A small screen: a page that scrolls, the map in among its words. The
     header, the words and the way in first; the map under them, in a frame
     of its own on the page (`.window`, which the app's map element is moved
     into), and the rest of the words below it. The whole page takes the
     touches and scrolls from anywhere but the map, which pans. The page's
     own size, which is not the screen's where it is drawn on its side
     (lib/sideways.ts). A phone on its side is wide enough for the desk's
     page but far too low for it: that is the phone's page too. */
  @container mc-frame (max-width: 760px) or (max-height: 500px) {
    .landing {
      display: block;
      padding: 0;
      background: #070b11;
      text-shadow: none;
      pointer-events: auto;
      -webkit-overflow-scrolling: touch;
    }
    .landing::before { display: none; }
    header {
      padding: max(14px, calc(var(--mc-safe-top) + 8px)) max(18px, calc(var(--mc-safe-right) + 12px)) 4px max(18px, calc(var(--mc-safe-left) + 12px));
    }
    /* The map set into the page, edge to edge, fading in out of the page's
       dark at its top and out again at its bottom. Enough of it to see the
       weather on, never so much of the screen that the page cannot be
       scrolled past it. */
    .window {
      display: block;
      position: relative;
      height: clamp(220px, 72svh, 520px);
      height: clamp(220px, 72cqh, 520px);
      margin: 10px calc(-1 * var(--sheet-right)) 0 calc(-1 * var(--sheet-left));
      overflow: hidden;
      --fade: clamp(36px, 16%, 90px);
      -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
      mask-image: linear-gradient(180deg, transparent 0, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
    }
    /* The map's credits stand clear of the fades. */
    .window :global(.ol-attribution) { bottom: var(--fade) !important; max-height: calc(100% - 2 * var(--fade)); }
    .two-fingers {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 0 24px;
      background: rgba(7, 11, 17, 0.55);
      color: var(--ink);
      font-size: 17px;
      font-weight: 600;
      text-align: center;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
      pointer-events: none;
    }
    .sheet {
      --sheet-left: max(18px, calc(var(--mc-safe-left) + 12px));
      --sheet-right: max(18px, calc(var(--mc-safe-right) + 12px));
      display: block;
      padding: 18px var(--sheet-right) calc(22px + var(--mc-safe-bottom)) var(--sheet-left);
    }
    main { width: 100%; }
    .screen { width: 38px; padding: 0; justify-content: center; }
    .screen span { display: none; }
    .home.top { display: none; }
    .home.by-board { display: inline-flex; height: 52px; padding: 0 22px 0 18px; font-size: 16px; }
    .brief { margin-top: 26px; }
    .eyebrow { margin-bottom: 10px; }
    .lede { margin-top: 12px; }
    .go { margin-top: 22px; }
    .go .board, .go .home.by-board { flex: 1 1 auto; justify-content: center; }
    footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid rgba(255, 255, 255, 0.08); justify-content: space-between; }
  }
  /* The smallest phones: the button by the way in says whose the page is. */
  @container mc-frame (max-width: 400px) {
    .mark a { display: none; }
  }
  /* A small screen with room for two columns (a phone on its side, a small
     tablet upright): under the way in, the map on the right, out to the
     screen's edge and fading into the page on its other three sides, and
     the rest of the words beside it and on below it. */
  @container mc-frame (min-width: 600px) and ((max-width: 760px) or (max-height: 500px)) {
    main { display: flow-root; }
    .window {
      --fade: clamp(28px, 12%, 64px);
      float: right;
      width: min(56%, 560px);
      height: clamp(220px, 76svh, 440px);
      height: clamp(220px, 76cqh, 440px);
      margin: 14px calc(-1 * var(--sheet-right)) 18px 22px;
      -webkit-mask-image:
        linear-gradient(90deg, transparent 0, #000 var(--fade)),
        linear-gradient(180deg, transparent 0, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
      -webkit-mask-composite: source-in;
      mask-image:
        linear-gradient(90deg, transparent 0, #000 var(--fade)),
        linear-gradient(180deg, transparent 0, #000 var(--fade), #000 calc(100% - var(--fade)), transparent 100%);
      mask-composite: intersect;
    }
    /* Beside the map, the line that sets the words off from the way in would run behind it. */
    .brief { margin-top: 14px; padding-top: 0; border-top: 0; }
    /* Its two lists one after the other, so their rows go on under the map where it ends. */
    .guide { display: block; }
    .guide section + section { margin-top: 18px; }
    footer { clear: both; }
  }
</style>
