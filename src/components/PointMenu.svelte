<script lang="ts">
/**
 * What a long press on the radar map offers: the precipitation at that point,
 * the forecast for it, or a link to it to send someone.
 *
 * The hold used to go straight to the precipitation strip. The model
 * comparison asks about a point too, and the hold is the map's one "tell me
 * about here" gesture, so rather than a second gesture for it the hold now
 * asks which question was meant -- a context menu, the way a long press works
 * everywhere else on the platform.
 *
 * Headed with the place's name, looked up as it opens, and "At this
 * location" until that answer lands or when there is none.
 *
 * Pinned to the point with an OpenLayers overlay, over a dot marking it, with
 * a notch pointing at the dot, and placed so it stays on screen: above the
 * point, or below it near the top, leaning inwards near either side. Anything else the reader does closes it
 * -- a tap elsewhere, Escape, the map moving, another layer, a storm tapped.
 */
import { onDestroy, onMount } from "svelte";
import { _, locale } from "svelte-i18n";
import { get } from "svelte/store";
import Overlay, { type Positioning } from "ol/Overlay";
import { fromLonLat } from "ol/proj";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import { faDroplet } from "@fortawesome/free-solid-svg-icons/faDroplet";
import { faChartLine } from "@fortawesome/free-solid-svg-icons/faChartLine";
import Icon from "./Icon.svelte";
import { share, shareAvailable, shareIcon } from "../lib/share";
import { inspectLatLon, mapView, pointMenuAt, selectedCell, selectedVolume, sharedActiveCap } from "../stores";
import { openModelCompare } from "../lib/modelCompare";
import { holdNativeChrome } from "../lib/nativeBridge";
import { reverseGeocode } from "../lib/reverseGeocode";
import type { LayerManager } from "../lib/LayerManager";

export let layerManager: LayerManager;

/** Room the menu needs above the point, and to either side of it, in px. */
const NEEDS_ABOVE = 170;
const NEEDS_SIDE = 120;
/** More above it for the share entry, where there is one: an entry's height. */
const SHARE_ENTRY = 56;
/**
 * How far into the menu the notch sits when the menu leans to one side: clear
 * of the 20px corner, so the notch comes off a straight edge rather than out
 * of the curve. Less where the point is nearer the screen's edge than this.
 */
const LEAN = 30;
/** The notch's and the dot's half-widths, to centre them on the lean. */
const NOTCH_HALF = 9;
const DOT_HALF = 7;

let element: HTMLElement;
let menu: HTMLElement;
let overlay: Overlay | null = null;
let below = false;
let side: "left" | "center" | "right" = "center";
/** How far in from the menu's leaning edge the point is, in px. */
let lean = 0;
/** The place's name, once known, for the point it was asked for. */
let placeName: string | null = null;
let namedFor: [number, number] | null = null;

async function name(point: [number, number] | null) {
  namedFor = point;
  placeName = null;
  if (!point) return;
  const found = await reverseGeocode(point[0], point[1], get(locale) ?? "en", "local", "point-menu");
  // Another hold since, or the menu put away: the answer is for nowhere shown.
  if (namedFor === point) placeName = found;
}
$: void name($pointMenuAt);
let keys: EventsKey[] = [];

const map = () => layerManager.getCapability("radar")?.getMap();

onMount(() => {
  const radar = map();
  if (!radar) return undefined;
  overlay = new Overlay({ element, stopEvent: true });
  radar.addOverlay(overlay);
  // The point is under the finger that held it; once the map moves it is not.
  keys = [radar.on("movestart", close)];
  return () => {
    unByKey(keys);
    if (overlay) radar.removeOverlay(overlay);
  };
});

function place(point: [number, number] | null) {
  const radar = map();
  if (!overlay || !radar) return;
  if (!point) {
    overlay.setPosition(undefined);
    return;
  }
  const coordinate = fromLonLat([point[1], point[0]]);
  const pixel = radar.getPixelFromCoordinate(coordinate);
  const width = radar.getSize()?.[0] ?? 0;
  below = !!pixel && pixel[1] < NEEDS_ABOVE + (get(shareAvailable) ? SHARE_ENTRY : 0);
  side = !pixel ? "center"
    : pixel[0] < NEEDS_SIDE ? "left"
      : pixel[0] > width - NEEDS_SIDE ? "right" : "center";
  // The menu's edge goes LEAN past the point, so the notch has straight edge
  // to come off -- short of the screen's own edge, though, by a gutter.
  const room = !pixel ? 0 : side === "left" ? pixel[0] - 8 : width - pixel[0] - 8;
  lean = side === "center" ? 0 : Math.max(0, Math.min(LEAN, room));
  overlay.setPositioning(`${below ? "top" : "bottom"}-${side}` as Positioning);
  overlay.setOffset([side === "left" ? -lean : side === "right" ? lean : 0, 0]);
  overlay.setPosition(coordinate);
  // Where the keyboard goes, so Escape and the arrow keys reach it.
  requestAnimationFrame(() => menu?.querySelector("button")?.focus({ preventScroll: true }));
}
$: place($pointMenuAt);

function close() {
  if ($pointMenuAt) pointMenuAt.set(null);
}

/* Placed to stay on screen, the menu can still open under the apps' buttons
   in the top corner, which nothing here can move -- so they go while it is up. */
let releaseChrome: (() => void) | null = null;
function holdChrome(open: boolean) {
  if (open && !releaseChrome) releaseChrome = holdNativeChrome();
  else if (!open && releaseChrome) {
    releaseChrome();
    releaseChrome = null;
  }
}
$: holdChrome($pointMenuAt !== null);

/* Held on another layer, or a storm tapped: the question is somewhere else. */
$: if ($sharedActiveCap !== "radar" || $selectedCell || $selectedVolume) close();

function precipitation() {
  const point = $pointMenuAt;
  close();
  if (point) inspectLatLon.set(point);
}

function forecast() {
  const point = $pointMenuAt;
  close();
  if (point) openModelCompare(point[0], point[1]);
}

/**
 * A link to the map centred on the point, with the point's precipitation open
 * the way "Precipitation" opens it here, so the receiver lands on the place
 * and on what it is getting. The share reads the button's place before the
 * menu goes, for the popover an iPad points at it.
 */
function sendPoint(event: MouseEvent) {
  const point = $pointMenuAt;
  if (!point) return;
  const view = get(mapView);
  void share({
    change: { view: { lat: point[0], lon: point[1], zoom: view?.zoom ?? 8 }, point },
    subject: placeName,
    anchor: event.currentTarget as Element,
  });
  close();
}

/* A tap anywhere else puts it away, as a context menu does. Capture phase,
   so it is seen before whatever the tap lands on. */
function onOutside(event: PointerEvent) {
  if ($pointMenuAt && !element.contains(event.target as Node)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && $pointMenuAt) {
    event.preventDefault();
    close();
  }
}
window.addEventListener("pointerdown", onOutside, true);
window.addEventListener("keydown", onKeydown, true);
onDestroy(() => {
  holdChrome(false);
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKeydown, true);
});
</script>

<div class="anchor">
  <div
    bind:this={element}
    class="point {side}"
    class:below
    class:shown={$pointMenuAt !== null}
    style:--lean="{lean}px"
    style:--notch-half="{NOTCH_HALF}px"
    style:--dot-half="{DOT_HALF}px">
    <div bind:this={menu} class="menu glass" role="menu" aria-label={placeName ?? $_("point_menu_title")}>
      <p class="head">{placeName ?? $_("point_menu_title")}</p>
      <button type="button" role="menuitem" on:click={precipitation}>
        <span class="icon"><Icon icon={faDroplet} /></span>
        <span class="text">
          <span class="label">{$_("point_menu_precipitation")}</span>
          <span class="sub">{$_("point_menu_precipitation_sub")}</span>
        </span>
      </button>
      <button type="button" role="menuitem" on:click={forecast}>
        <span class="icon"><Icon icon={faChartLine} /></span>
        <span class="text">
          <span class="label">{$_("point_menu_forecast")}</span>
          <span class="sub">{$_("point_menu_forecast_sub")}</span>
        </span>
      </button>
      {#if $shareAvailable}
        <button type="button" role="menuitem" on:click={sendPoint}>
          <span class="icon"><Icon icon={shareIcon()} /></span>
          <span class="text">
            <span class="label">{$_("point_menu_share")}</span>
            <span class="sub">{$_("point_menu_share_sub")}</span>
          </span>
        </button>
      {/if}
    </div>
    <span class="notch" aria-hidden="true"></span>
    <span class="dot" aria-hidden="true"></span>
  </div>
</div>

<style>
  /* Where the element waits until OpenLayers moves it into the map. */
  .anchor { display: none; }

  /* The menu and the dot under it, placed as one. The dot is the point, so
     the column's far end is it: the bottom when the menu is above, the top
     when it has flipped below. No material here -- a backdrop filter on this
     would leave the menu's own blurring nothing. */
  .point {
    display: flex;
    flex-direction: column;
    align-items: center;
    opacity: 0;
    transform: scale(0.94);
    transform-origin: 50% 100%;
    transition:
      opacity var(--mc-motion-fast) var(--mc-ease),
      transform var(--mc-motion-spring) var(--mc-ease-spring);
  }
  .point.below {
    flex-direction: column-reverse;
    transform-origin: 50% 0;
  }
  .point.shown {
    opacity: 1;
    transform: none;
  }
  /* Leaning inwards at the sides: OpenLayers puts the element's edge on the
     point there, so the dot goes to that edge too, a dot's half-width in. */
  .point.left { align-items: flex-start; transform-origin: 0 100%; }
  .point.right { align-items: flex-end; transform-origin: 100% 100%; }
  .point.below.left { transform-origin: 0 0; }
  .point.below.right { transform-origin: 100% 0; }
  .point.left .dot { margin-left: calc(var(--lean) - var(--dot-half)); }
  .point.right .dot { margin-right: calc(var(--lean) - var(--dot-half)); }
  .point.left .notch { margin-left: calc(var(--lean) - var(--notch-half)); }
  .point.right .notch { margin-right: calc(var(--lean) - var(--notch-half)); }

  /* The notch, from the menu to the dot: the menu's fill and blur, so it reads
     as part of the bubble. A sibling rather than a pseudo-element of the menu,
     whose own backdrop filter would leave it blurring nothing -- a backdrop
     sees only as far as the nearest ancestor with one. Tucked a pixel under
     the menu's rim so no seam shows, and turned over when the menu is below. */
  .notch {
    flex: none;
    width: calc(2 * var(--notch-half));
    height: 9px;
    margin-top: -1px;
    margin-bottom: 5px;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    background: var(--mc-glass-fill-strong);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
  }
  .point.below .notch {
    margin-top: 5px;
    margin-bottom: -1px;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }

  .dot {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    /* Red, as a dropped pin is: blue is the reader's own position, and a
       second blue dot beside it would read as the same thing. */
    background: var(--mc-red);
    box-shadow: 0 0 0 3px #fff, 0 1px 6px rgba(0, 0, 0, 0.35);
  }

  .menu {
    min-width: 232px;
    max-width: 280px;
    padding: 6px;
    border-radius: 20px;
    background: var(--mc-glass-fill-strong);
    box-shadow: var(--mc-glass-ring-lg);
  }

  /* The place is what the menu is about, so it heads it in the primary ink;
     a long name gives way at the end rather than widening the menu. */
  .head {
    margin: 5px 10px 7px;
    font: 700 14px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin: 0;
    padding: 9px 10px;
    border: 0;
    border-radius: 14px;
    background: none;
    color: var(--mc-text);
    font-family: var(--mc-font);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  button + button {
    margin-top: 2px;
  }
  button:hover,
  button:focus-visible {
    background: var(--mc-tint);
    outline: none;
  }
  button:active {
    background: var(--mc-tint-active);
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
    font-size: 15px;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .label {
    font: 600 15px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
  }
  .sub {
    font: 400 12px/1.3 var(--mc-font);
    color: var(--mc-text-2);
  }
</style>
