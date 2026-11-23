<script lang="ts">
/**
 * A meteoair flight's card, tapped on the radar map (layers/flightTracks.ts):
 * when it was flown, how far and how high, and the flight again from where
 * it left off or from where it took off; or the track off the map.
 *
 * Pinned to where the track was tapped with an OpenLayers overlay, a notch
 * pointing at it, and placed so it stays on screen as the point menu is
 * (PointMenu.svelte). It follows the map as it moves; a tap elsewhere,
 * Escape, another layer or a storm tapped puts it away.
 */
import { onDestroy, onMount } from "svelte";
import { _, locale } from "svelte-i18n";
import Overlay, { type Positioning } from "ol/Overlay";
import { fromLonLat } from "ol/proj";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faTrashCan } from "@fortawesome/free-solid-svg-icons/faTrashCan";
import Icon from "./Icon.svelte";
import { cells3dFailed, selectedStorm, sharedActiveCap } from "../stores";
import {
  deleteTrack, firstPoint, flightTracks, highestOf, lastPoint, selectedFlightTrack, startFrom, trackLength,
} from "../lib/studio/flightTracks";
import type { FlightTrack } from "../lib/studio/flightTracks";
import { canFlyFromMap, flyFromMap } from "../lib/studio/flyFromMap";
import { hideNativeControls } from "../lib/nativeBridge";
import type { LayerManager } from "../lib/LayerManager";

export let layerManager: LayerManager;

/** Room the card needs above the point, and to either side of it, in px. */
const NEEDS_ABOVE = 300;
const NEEDS_SIDE = 140;
/** How far into the card the notch sits when it leans to one side; see PointMenu.svelte. */
const LEAN = 30;
const NOTCH_HALF = 9;
const FEET = 3.28084;

let element: HTMLElement;
let card: HTMLElement;
let overlay: Overlay | null = null;
let below = false;
let side: "left" | "center" | "right" = "center";
let lean = 0;

const map = () => layerManager.getCapability("radar")?.getMap();

$: track = $selectedFlightTrack ? $flightTracks.find((one) => one.id === $selectedFlightTrack?.id) ?? null : null;
/* Flown again only where a flight can take off from this map now; offered
   or not in this build, since the reader has flown it already. */
$: flyable = canFlyFromMap(layerManager, $cells3dFailed, false);

onMount(() => {
  const radar = map();
  if (!radar) return undefined;
  overlay = new Overlay({ element, stopEvent: true });
  radar.addOverlay(overlay);
  return () => {
    if (overlay) radar.removeOverlay(overlay);
  };
});

function place(at: [number, number] | null) {
  const radar = map();
  if (!overlay || !radar) return;
  if (!at) {
    overlay.setPosition(undefined);
    return;
  }
  const coordinate = fromLonLat(at);
  const pixel = radar.getPixelFromCoordinate(coordinate);
  const width = radar.getSize()?.[0] ?? 0;
  below = !!pixel && pixel[1] < NEEDS_ABOVE;
  side = !pixel ? "center" : pixel[0] < NEEDS_SIDE ? "left" : pixel[0] > width - NEEDS_SIDE ? "right" : "center";
  const room = !pixel ? 0 : side === "left" ? pixel[0] - 8 : width - pixel[0] - 8;
  lean = side === "center" ? 0 : Math.max(0, Math.min(LEAN, room));
  overlay.setPositioning(`${below ? "top" : "bottom"}-${side}` as Positioning);
  overlay.setOffset([side === "left" ? -lean : side === "right" ? lean : 0, below ? 6 : -6]);
  overlay.setPosition(coordinate);
  requestAnimationFrame(() => card?.querySelector("button")?.focus({ preventScroll: true }));
}
$: place(track && $selectedFlightTrack ? $selectedFlightTrack.at : null);

function close() {
  if ($selectedFlightTrack) selectedFlightTrack.set(null);
}

/* Over the apps' buttons in the top corner, which nothing here can move, so they go while it is up. */
let releaseChrome: (() => void) | null = null;
function holdChrome(open: boolean) {
  if (open && !releaseChrome) releaseChrome = hideNativeControls();
  else if (!open && releaseChrome) {
    releaseChrome();
    releaseChrome = null;
  }
}
$: holdChrome(track !== null);

$: if ($sharedActiveCap !== "radar" || $selectedStorm) close();

/** What is said of a track: when, how long ago, how far, how high. */
function describe(flown: FlightTrack, language: string | null | undefined, _tick: number) {
  const lang = language ?? "en";
  const began = firstPoint(flown)?.[3] ?? Date.now();
  const ended = lastPoint(flown)?.[3] ?? began;
  const clock = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" });
  const minutes = Math.max(0, Math.round((Date.now() - ended) / 60_000));
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  const ago = minutes < 1 ? $_("flight_track_just_now")
    : minutes < 60 ? relative.format(-minutes, "minute") : relative.format(-Math.round(minutes / 6) / 10, "hour");
  const km = trackLength(flown) / 1000;
  const distance = new Intl.NumberFormat(lang, { style: "unit", unit: "kilometer", maximumFractionDigits: km < 10 ? 1 : 0 }).format(km);
  const highest = highestOf(flown);
  const levelOf = (metres: number | null) => (metres === null ? "–" : `FL${String(Math.max(0, Math.round((metres * FEET) / 100))).padStart(3, "0")}`);
  const time = clock.formatRange ? clock.formatRange(new Date(began), new Date(ended)) : clock.format(new Date(began));
  const state = flown.last.state as Record<string, unknown> | undefined;
  const lastAltitude = typeof state?.altitude === "number" ? state.altitude : null;
  return { time, ago, distance, level: levelOf(highest), lastLevel: levelOf(lastAltitude) };
}
// Again as the minutes go by, while it is open.
let tick = 0;
const ticker = window.setInterval(() => { tick += 1; }, 30_000);
$: about = track ? describe(track, $locale, tick) : null;

function fly(from: "last" | "start") {
  const flown = track;
  close();
  if (!flown) return;
  const start = startFrom(from === "last" ? flown.last : flown.first);
  if (!start) return;
  flyFromMap(layerManager, start, { track: { id: flown.id, from } });
}

function remove() {
  const flown = track;
  close();
  if (flown) deleteTrack(flown.id);
}

/* A tap anywhere else puts it away. Capture phase, so it is seen before whatever the tap lands on. */
function onOutside(event: PointerEvent) {
  if ($selectedFlightTrack && !element.contains(event.target as Node)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && $selectedFlightTrack) {
    event.preventDefault();
    close();
  }
}
window.addEventListener("pointerdown", onOutside, true);
window.addEventListener("keydown", onKeydown, true);
onDestroy(() => {
  holdChrome(false);
  window.clearInterval(ticker);
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKeydown, true);
});
</script>

<div class="anchor">
  <div
    bind:this={element}
    class="track {side}"
    class:below
    class:shown={track !== null}
    style:--lean="{lean}px"
    style:--notch-half="{NOTCH_HALF}px">
    <div bind:this={card} class="card glass" role="dialog" aria-label={$_("flight_track_title")}>
      <p class="head">{$_("flight_track_title")}</p>
      {#if about}
        <p class="meta">{$_("flight_track_meta", { values: { time: about.time, ago: about.ago, distance: about.distance, level: about.level } })}</p>
      {/if}
      {#if flyable && track}
        <button type="button" on:click={() => fly("last")}>
          <span class="icon"><Icon icon={faPlay} /></span>
          <span class="text">
            <span class="label">{$_("flight_track_resume")}</span>
            <span class="sub">
              {track.crashed ? $_("flight_track_resume_crashed") : $_("flight_track_resume_sub", { values: { level: about?.lastLevel ?? "" } })}
            </span>
          </span>
        </button>
        <button type="button" on:click={() => fly("start")}>
          <span class="icon"><Icon icon={faRotateLeft} /></span>
          <span class="text">
            <span class="label">{$_("flight_track_restart")}</span>
            <span class="sub">{$_("flight_track_restart_sub")}</span>
          </span>
        </button>
      {/if}
      <button type="button" class="delete" on:click={remove}>
        <span class="icon"><Icon icon={faTrashCan} /></span>
        <span class="text">
          <span class="label">{$_("flight_track_delete")}</span>
          <span class="sub">{$_("flight_track_delete_sub")}</span>
        </span>
      </button>
      <p class="note">{$_("flight_track_note")}</p>
    </div>
    <span class="notch" aria-hidden="true"></span>
  </div>
</div>

<style>
  /* Where the element waits until OpenLayers moves it into the map. */
  .anchor { display: none; }

  .track {
    display: flex;
    flex-direction: column;
    align-items: center;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.94);
    transform-origin: 50% 100%;
    transition:
      opacity var(--mc-motion-fast) var(--mc-ease),
      transform var(--mc-motion-spring) var(--mc-ease-spring);
  }
  .track.below {
    flex-direction: column-reverse;
    transform-origin: 50% 0;
  }
  .track.shown {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
  .track.left { align-items: flex-start; transform-origin: 0 100%; }
  .track.right { align-items: flex-end; transform-origin: 100% 100%; }
  .track.below.left { transform-origin: 0 0; }
  .track.below.right { transform-origin: 100% 0; }
  .track.left .notch { margin-left: calc(var(--lean) - var(--notch-half)); }
  .track.right .notch { margin-right: calc(var(--lean) - var(--notch-half)); }

  /* The notch, from the card to the track: the card's fill and blur; see PointMenu.svelte. */
  .notch {
    flex: none;
    width: calc(2 * var(--notch-half));
    height: 9px;
    margin-top: -1px;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
    background: var(--mc-glass-fill-strong);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
  }
  .track.below .notch {
    margin-top: 0;
    margin-bottom: -1px;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }

  .card {
    min-width: 248px;
    max-width: 290px;
    padding: 6px;
    border-radius: 20px;
    background: var(--mc-glass-fill-strong);
    box-shadow: var(--mc-glass-ring-lg);
  }

  .head {
    margin: 5px 10px 0;
    font: 700 14px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
  }
  .meta {
    margin: 2px 10px 7px;
    font: 500 12px/1.3 var(--mc-font);
    color: var(--mc-text-2);
    font-variant-numeric: tabular-nums;
  }
  .note {
    margin: 6px 10px 4px;
    font: 400 11px/1.35 var(--mc-font);
    color: var(--mc-text-2);
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
  button + button { margin-top: 2px; }
  button:hover,
  button:focus-visible {
    background: var(--mc-tint);
    outline: none;
  }
  button:active { background: var(--mc-tint-active); }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
    font-size: 14px;
  }
  .delete .icon {
    background: var(--mc-red-tint);
    color: var(--mc-red);
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
