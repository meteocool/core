<script lang="ts">
/**
 * The flight under two thumbs: what a phone or a tablet flies with, drawn on
 * the flight deck where there are no keys to hold.
 *
 * The right thumb has the stick, read from where it comes down; the left the
 * throttle lever, which stays where it is put, the rudder under it, and
 * beside it the brake and the faster clock, each while held. Low in the
 * middle a strip of buttons does what the other keys do, a press at a time
 * (`Pilot.act`), and opens for the rarer ones; while an alarm sounds, the
 * master light's button is on it too, to silence it. The phone itself can be the
 * yoke, from how it is held when that is switched on. The arithmetic of all
 * of it is lib/studio/flight/touch.ts.
 *
 * What is held goes to the pilot as the keys' own kind of input
 * (`Pilot.touch`), every frame: the aircraft takes how fast the throttle
 * moves, not where it should be, so the rate that brings it to the lever is
 * worked out against where it has got to.
 *
 * Fingers on the view itself are read here too: one turns the eye, two
 * pinch it nearer or further off. The deck's own surface reads a mouse's
 * movement, which a finger does not report in every browser, so a finger's
 * moves are taken before they reach it, and its presses and releases left
 * alone.
 *
 * Shown from the start where the pointer is a finger, and from the first
 * touch on a laptop with a touch screen. In the clean view nothing of it is
 * drawn but a small way back out; the stick and the lever still fly where
 * they were, and show faintly under a thumb.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import { faChevronUp } from "@fortawesome/free-solid-svg-icons/faChevronUp";
import { faCloudBolt } from "@fortawesome/free-solid-svg-icons/faCloudBolt";
import { faEye } from "@fortawesome/free-solid-svg-icons/faEye";
import { faForward } from "@fortawesome/free-solid-svg-icons/faForward";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
import { faMobileScreen } from "@fortawesome/free-solid-svg-icons/faMobileScreen";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRotate } from "@fortawesome/free-solid-svg-icons/faRotate";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import Icon from "../../Icon.svelte";
import { fullscreen, fullscreenSupported, toggleFullscreen } from "../../../lib/fullscreen";
import { masterLights } from "../../../lib/studio/flight/alarms";
import type { FlightAction } from "../../../lib/studio/flight/controls";
import { FLAPS_MOST } from "../../../lib/studio/flight/physics";
import type { Pilot, Telemetry } from "../../../lib/studio/flight/pilot";
import { flightMuted } from "../../../lib/studio/flight/sound";
import MusicIcon from "./MusicIcon.svelte";
import {
  axisInput, LEVER_IDLE, LEVER_IDLE_REST, LEVER_REVERSE, leverAt, leverRate, leverShare, pinchSteps, stickInput, tiltInput, tiltOf,
  touchCapable, touchControls, touchFirst,
} from "../../../lib/studio/flight/touch";
import type { Tilt } from "../../../lib/studio/flight/touch";
import { flightStatus } from "../../../lib/studio/store";
import { currentTurn, frameBox, framePoint, sidewaysTurn } from "../../../lib/sideways";

export let pilot: Pilot;

$: status = $flightStatus;
$: clean = status.view === "clean";
/** The master lights, and whether anything sounds that the master light's button would silence. */
$: lights = masterLights(status.alarms, status.silenced);

let root: HTMLDivElement | null = null;

/* ---- what is held ---- */

/** The stick and the rudder, as last read off a thumb; the phone held as a yoke; the buttons held. */
let stick = { roll: 0, pitch: 0 };
let tilt = { roll: 0, pitch: 0 };
let yaw = 0;
let brake = false;
let warp = false;
/** Where the lever was put, 0 to 1, until the throttle has got there; and whether it is held below idle, for the reversers. */
let lever: number | null = null;
let reversing = false;
/** How fast the throttle is being moved for it, -1 to 1: worked out each frame. */
let rate = 0;
/** The throttle as the last frame had it. */
let throttle = 0;

const larger = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);

/** Hand the pilot what is held now; nothing at all with no finger on anything. */
function send(): void {
  const input = {
    pitch: larger(stick.pitch, tilt.pitch), roll: larger(stick.roll, tilt.roll), yaw, throttle: rate, brake, warp,
  };
  const idle = !input.pitch && !input.roll && !yaw && !rate && !brake && !warp;
  pilot.touch(idle ? null : input);
}

/** A press on a control is its own: not a drag of the view under it, nor the page's to scroll, select or zoom by. */
function take(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser no longer has: it is followed for as long as its moves still arrive.
  }
}

/* ---- the stick ---- */

let stickElement: HTMLDivElement | null = null;
let knob: HTMLElement | null = null;
/** The finger on the stick, and where it came down: the stick is read from there, wherever on it that was. */
let stickFinger: { id: number; x: number; y: number } | null = null;

function stickDown(event: PointerEvent): void {
  if (stickFinger) return;
  take(event);
  const [x, y] = framePoint(event);
  stickFinger = { id: event.pointerId, x, y };
}
function stickMove(event: PointerEvent): void {
  if (!stickFinger || event.pointerId !== stickFinger.id || !stickElement || !knob) return;
  const reach = (stickElement.clientWidth - knob.offsetWidth) / 2 + 6;
  const [x, y] = framePoint(event);
  const read = stickInput(x - stickFinger.x, y - stickFinger.y, reach);
  stick = { roll: read.roll, pitch: read.pitch };
  knob.style.transform = `translate(${read.x.toFixed(1)}px, ${read.y.toFixed(1)}px)`;
  send();
}
function stickUp(event: PointerEvent): void {
  if (!stickFinger || event.pointerId !== stickFinger.id) return;
  stickFinger = null;
  stick = { roll: 0, pitch: 0 };
  if (knob) knob.style.transform = "";
  send();
}

/* ---- the rudder ---- */

let rudderElement: HTMLDivElement | null = null;
let rudderKnob: HTMLElement | null = null;
let rudderFinger: { id: number; x: number } | null = null;

function rudderDown(event: PointerEvent): void {
  if (rudderFinger) return;
  take(event);
  rudderFinger = { id: event.pointerId, x: framePoint(event)[0] };
}
function rudderMove(event: PointerEvent): void {
  if (!rudderFinger || event.pointerId !== rudderFinger.id || !rudderElement || !rudderKnob) return;
  const reach = (rudderElement.clientWidth - rudderKnob.offsetWidth) / 2;
  const travel = Math.min(Math.max(framePoint(event)[0] - rudderFinger.x, -reach), reach);
  yaw = axisInput(travel, reach);
  rudderKnob.style.transform = `translateX(${travel.toFixed(1)}px)`;
  send();
}
function rudderUp(event: PointerEvent): void {
  if (!rudderFinger || event.pointerId !== rudderFinger.id) return;
  rudderFinger = null;
  yaw = 0;
  if (rudderKnob) rudderKnob.style.transform = "";
  send();
}

/* ---- the throttle lever ---- */

let leverElement: HTMLDivElement | null = null;
let grip: HTMLElement | null = null;
let fill: HTMLElement | null = null;
/** The finger on the lever: where on the track it is, a share from the bottom, and how far off the grip it took hold. */
let leverFinger: { id: number; share: number; off: number } | null = null;

/** Where on the track a finger is, a share from the bottom: of the grip's travel, which is the track less the grip itself. */
function shareAt(event: PointerEvent): number {
  if (!leverElement || !grip) return 0;
  const box = frameBox(leverElement);
  const travel = Math.max(1, box.height - grip.offsetHeight);
  return 1 - (framePoint(event)[1] - box.top - grip.offsetHeight / 2) / travel;
}

/** Where the grip is drawn: under the finger, in the notch while that is anywhere in it; otherwise where it was put, or where the throttle is. */
function gripShare(): number {
  if (leverFinger) {
    const share = Math.min(Math.max(leverFinger.share, 0), 1);
    return share >= LEVER_REVERSE && share <= LEVER_IDLE ? LEVER_IDLE_REST : share;
  }
  return leverShare(lever ?? throttle);
}

function drawLever(): void {
  if (!leverElement || !grip || !fill) return;
  const travel = Math.max(1, leverElement.clientHeight - grip.offsetHeight);
  grip.style.transform = `translateY(${(-gripShare() * travel).toFixed(1)}px)`;
  // What the engines are asked for now, behind the grip: the lever leads it by a moment.
  fill.style.height = `${(leverShare(throttle) * travel + grip.offsetHeight / 2).toFixed(1)}px`;
}

function leverTo(share: number): void {
  const asked = leverAt(share);
  reversing = asked.reverse;
  lever = asked.lever;
  rate = reversing ? -1 : leverRate(asked.lever, throttle);
  drawLever();
  send();
}
function leverDown(event: PointerEvent): void {
  if (leverFinger) return;
  take(event);
  const at = shareAt(event);
  // Taken hold of by the grip, it moves with the thumb from where it is; pressed anywhere else on the track, it comes to the thumb.
  const off = at - gripShare();
  leverFinger = { id: event.pointerId, share: at, off: Math.abs(off) < 0.16 ? off : 0 };
  leverFinger.share = at - leverFinger.off;
  leverTo(leverFinger.share);
}
function leverMove(event: PointerEvent): void {
  if (!leverFinger || event.pointerId !== leverFinger.id) return;
  leverFinger.share = shareAt(event) - leverFinger.off;
  leverTo(leverFinger.share);
}
function leverUp(event: PointerEvent): void {
  if (!leverFinger || event.pointerId !== leverFinger.id) return;
  leverFinger = null;
  // Let go below idle, it springs back up to idle: the reversers are held, not set.
  reversing = false;
  rate = lever === null ? 0 : leverRate(lever, throttle);
  drawLever();
  send();
}

/* ---- the buttons held ---- */

function hold(which: "brake" | "warp", on: boolean, event: PointerEvent): void {
  if (on) take(event);
  if (which === "brake") brake = on;
  else warp = on;
  send();
}

/* ---- every frame ---- */

function frame(telemetry: Telemetry): void {
  throttle = telemetry.state.throttle;
  if (reversing) {
    rate = -1;
  } else if (lever !== null) {
    rate = leverRate(lever, throttle);
    // There, and let go of: the throttle is the keys' or a gamepad's again, and the grip follows it.
    if (rate === 0 && !leverFinger) lever = null;
  } else {
    rate = 0;
  }
  drawLever();
  send();
}

/* ---- the phone as a yoke ---- */

type OrientationEvents = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

let tilting = false;
/** How the phone was held when tilting began: what it is read against. */
let neutral: Tilt | null = null;
/** When the phone last said how it is held, by the page's clock, ms. */
let tiltAt = 0;
let tiltRefused = false;
let refusedTimer: ReturnType<typeof setTimeout> | null = null;
let silentTimer: ReturnType<typeof setTimeout> | null = null;

/** How far the page is turned on the screen, degrees: by the browser, and on its side in the apps by the page itself (lib/sideways.ts). */
const turned = (): number => ((typeof screen !== "undefined" && screen.orientation?.angle)
  || Number((window as Window & { orientation?: number }).orientation ?? 0)) + currentTurn();

function tilted(event: DeviceOrientationEvent): void {
  if (event.beta === null || event.gamma === null) return;
  if (silentTimer !== null) clearTimeout(silentTimer);
  silentTimer = null;
  const now = tiltOf(event.beta, event.gamma, turned());
  neutral ??= now;
  const asked = tiltInput(now, neutral);
  // A hand shakes faster than it flies: what it asks is followed over a few hundredths of a second, however often it is read.
  const closing = 1 - Math.exp(-Math.max(0, event.timeStamp - tiltAt) / 50);
  tiltAt = event.timeStamp;
  tilt = { roll: tilt.roll + (asked.roll - tilt.roll) * closing, pitch: tilt.pitch + (asked.pitch - tilt.pitch) * closing };
  if (Math.abs(tilt.roll) < 0.004) tilt.roll = 0;
  if (Math.abs(tilt.pitch) < 0.004) tilt.pitch = 0;
  send();
}
/** The phone turned over to its other side: held anew, read anew. */
function turnedOver(): void {
  neutral = null;
}

function stopTilt(): void {
  tilting = false;
  neutral = null;
  tilt = { roll: 0, pitch: 0 };
  if (silentTimer !== null) clearTimeout(silentTimer);
  silentTimer = null;
  window.removeEventListener("deviceorientation", tilted);
  send();
}

function refuseTilt(): void {
  stopTilt();
  tiltRefused = true;
  if (refusedTimer !== null) clearTimeout(refusedTimer);
  refusedTimer = setTimeout(() => { tiltRefused = false; }, 5000);
}

/** Tilt on or off. From a tap, which is when a browser that asks the reader first lets a page ask. */
async function toggleTilt(): Promise<void> {
  if (tilting) {
    stopTilt();
    return;
  }
  const events = (window as Window & { DeviceOrientationEvent?: OrientationEvents }).DeviceOrientationEvent;
  if (!events) {
    refuseTilt();
    return;
  }
  try {
    if (typeof events.requestPermission === "function" && (await events.requestPermission()) !== "granted") {
      refuseTilt();
      return;
    }
  } catch {
    refuseTilt();
    return;
  }
  tilting = true;
  tiltRefused = false;
  neutral = null;
  window.addEventListener("deviceorientation", tilted);
  // A device with nothing to say of how it is held says nothing: not a yoke.
  silentTimer = setTimeout(refuseTilt, 2000);
}

/* ---- fingers on the view ---- */

/** The fingers down on the view, each where it last was; and how far apart two of them were. */
let fingers: Array<{ id: number; x: number; y: number }> = [];
let spread: number | null = null;
const onView = (target: EventTarget | null) => target instanceof Element && target.closest(".look") !== null;

function viewDown(event: PointerEvent): void {
  if (event.pointerType !== "touch" || !onView(event.target)) return;
  const [x, y] = framePoint(event);
  fingers = [...fingers.filter((finger) => finger.id !== event.pointerId), { id: event.pointerId, x, y }];
  spread = null;
}
function viewMove(event: PointerEvent): void {
  const finger = fingers.find((one) => one.id === event.pointerId);
  if (!finger) return;
  // Read here, from where the finger was: the deck's surface would read a mouse's movement off it, and both fingers of a pinch.
  event.stopPropagation();
  const [x, y] = framePoint(event);
  const [dx, dy] = [x - finger.x, y - finger.y];
  finger.x = x;
  finger.y = y;
  if (fingers.length === 1) {
    pilot.lookBy(dx, dy);
  } else if (fingers.length === 2) {
    const [a, b] = fingers;
    const apart = Math.hypot(a.x - b.x, a.y - b.y);
    if (spread !== null) pilot.zoomBy(pinchSteps(spread, apart));
    spread = apart;
  }
}
function viewUp(event: PointerEvent): void {
  if (!fingers.some((finger) => finger.id === event.pointerId)) return;
  fingers = fingers.filter((finger) => finger.id !== event.pointerId);
  spread = null;
}

/* ---- the screen ---- */

/** The strip's rarer buttons, put away until asked for. */
let more = false;

let portrait = false;
const canFullscreen = fullscreenSupported();

type LockingOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/** Hold the page on its side, where a browser lets one: it does only for a page that has the whole screen. */
let heldLandscape = false;
function holdLandscape(): void {
  try {
    void (screen.orientation as LockingOrientation | undefined)?.lock?.("landscape")
      ?.then(() => { heldLandscape = true; })
      .catch(() => undefined);
  } catch {
    // Not a browser that holds a page any way up: the reader turns the phone.
  }
}
// Not where the page is drawn on its side for a web view that does not turn (lib/sideways.ts): it is landscape already.
$: if ($fullscreen && $touchControls && !$sidewaysTurn) holdLandscape();

const act = (action: FlightAction) => () => pilot.act(action);

const listeners: Array<[EventTarget, string, EventListener, boolean]> = [];
let unlisten: (() => void) | null = null;
let portraitQuery: MediaQueryList | null = null;
const turnedPortrait = () => { portrait = Boolean(portraitQuery?.matches); };
// The page turned over on its side with the phone is the phone turned over too: held anew, read anew.
onDestroy(sidewaysTurn.subscribe(() => turnedOver()));

onMount(() => {
  if (touchFirst()) touchControls.set(true);
  unlisten = pilot.onFrame(frame);
  throttle = pilot.telemetry.state.throttle;
  const firstTouch = (event: Event) => {
    if ((event as PointerEvent).pointerType === "touch") touchControls.set(true);
  };
  const deck = root?.parentElement;
  if (touchCapable()) listeners.push([window, "pointerdown", firstTouch, true]);
  if (deck) {
    listeners.push(
      [deck, "pointerdown", viewDown as EventListener, true],
      [deck, "pointermove", viewMove as EventListener, true],
      [deck, "pointerup", viewUp as EventListener, true],
      [deck, "pointercancel", viewUp as EventListener, true],
    );
  }
  listeners.push([window, "orientationchange", turnedOver, false]);
  for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
  portraitQuery = window.matchMedia?.("(orientation: portrait)") ?? null;
  portraitQuery?.addEventListener("change", turnedPortrait);
  turnedPortrait();
});

onDestroy(() => {
  unlisten?.();
  for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
  portraitQuery?.removeEventListener("change", turnedPortrait);
  if (tilting) stopTilt();
  if (refusedTimer !== null) clearTimeout(refusedTimer);
  pilot.touch(null);
  if (!heldLandscape) return;
  try {
    screen.orientation.unlock();
  } catch {
    // Let go of already, with the whole screen.
  }
});
</script>

<!-- Always there, for the view's fingers to be heard through; filled once there are touch controls to show. -->
<div class="touch" class:clean role="group" aria-label={$_("studio.flight.touch.aria")} hidden={!$touchControls} bind:this={root}
  on:contextmenu|preventDefault>
  {#if $touchControls}
    <div class="left">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lever" class:held={leverFinger !== null} class:reverse={status.reverse} bind:this={leverElement}
        aria-label={$_("studio.flight.touch.throttle")}
        on:pointerdown={leverDown} on:pointermove={leverMove} on:pointerup={leverUp} on:pointercancel={leverUp}>
        <i class="fill" bind:this={fill}></i>
        <i class="notch" style:bottom={`${LEVER_IDLE_REST * 100}%`}></i>
        <span class="idle" style:bottom={`${LEVER_IDLE_REST * 100}%`}>{$_("studio.flight.touch.idle")}</span>
        <span class="rev">{$_("studio.flight.touch.reverse")}</span>
        <b class="grip" bind:this={grip}>{$_("studio.flight.touch.throttle_short")}</b>
      </div>
      <div class="holds">
        <button type="button" class="hold" class:held={warp} tabindex="-1" title={$_("studio.flight.touch.warp_title")}
          aria-label={$_("studio.flight.touch.warp_title")} aria-pressed={warp}
          on:pointerdown={(event) => hold("warp", true, event)} on:pointerup={(event) => hold("warp", false, event)}
          on:pointercancel={(event) => hold("warp", false, event)}>
          <Icon icon={faForward} /><span>4×</span>
        </button>
        <button type="button" class="hold brake" class:held={brake} tabindex="-1" title={$_("studio.flight.touch.brake_title")}
          aria-label={$_("studio.flight.touch.brake_title")} aria-pressed={brake}
          on:pointerdown={(event) => hold("brake", true, event)} on:pointerup={(event) => hold("brake", false, event)}
          on:pointercancel={(event) => hold("brake", false, event)}>
          <span>{$_("studio.flight.touch.brake")}</span>
        </button>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="rudder" class:held={rudderFinger !== null} bind:this={rudderElement} aria-label={$_("studio.flight.touch.rudder")}
        on:pointerdown={rudderDown} on:pointermove={rudderMove} on:pointerup={rudderUp} on:pointercancel={rudderUp}>
        <b class="knob" bind:this={rudderKnob}>{$_("studio.flight.touch.rudder_short")}</b>
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stick" class:held={stickFinger !== null} class:tilting bind:this={stickElement}
      aria-label={$_("studio.flight.touch.stick")}
      on:pointerdown={stickDown} on:pointermove={stickMove} on:pointerup={stickUp} on:pointercancel={stickUp}>
      <b class="knob" bind:this={knob}></b>
    </div>

    {#if clean}
      <!-- The way back out of the clean view, where V is. -->
      <button type="button" class="handle" tabindex="-1" on:click={act("view")}
        title={$_("studio.flight.touch.show")} aria-label={$_("studio.flight.touch.show")}>
        <Icon icon={faEye} />
      </button>
    {:else}
      <div class="strip glass glass-tray">
        {#if more}
          <div class="row rare">
            <button type="button" class="key" tabindex="-1" on:click={act("next")}>
              <Icon icon={faCloudBolt} /><span>{$_("studio.flight.touch.next")}</span>
            </button>
            <button type="button" class="key" tabindex="-1" on:click={act("restart")}>
              <Icon icon={faRotateLeft} /><span>{$_("studio.flight.touch.restart")}</span>
            </button>
            <button type="button" class="key" class:lit={status.paused} tabindex="-1" aria-pressed={status.paused} on:click={act("pause")}>
              <Icon icon={status.paused ? faPlay : faPause} />
              <span>{$_(status.paused ? "studio.flight.touch.resume" : "studio.flight.touch.pause")}</span>
            </button>
            <button type="button" class="key" class:lit={status.inspecting !== null} tabindex="-1" on:click={act("inspect")}>
              <Icon icon={faLayerGroup} /><span>{$_("studio.flight.touch.inspect")}</span>
            </button>
            <button type="button" class="key" class:lit={$flightMuted} tabindex="-1" aria-pressed={$flightMuted} on:click={act("mute")}>
              <MusicIcon off={$flightMuted} /><span>{$_("studio.flight.touch.sound")}</span>
            </button>
            <button type="button" class="key" class:lit={tilting} tabindex="-1" aria-pressed={tilting}
              title={$_("studio.flight.touch.tilt_title")} on:click={toggleTilt}>
              <Icon icon={faMobileScreen} /><span>{$_("studio.flight.touch.tilt")}</span>
            </button>
          </div>
        {/if}
        {#if lights.sounding}
          <div class="row">
            <button type="button" class="key master" class:caution={!lights.warning} tabindex="-1" title={$_("studio.flight.touch.silence_title")}
              aria-label={$_("studio.flight.touch.silence_title")} on:click={act("silence")}>
              <b>{$_(lights.warning ? "studio.flight.touch.master_warning" : lights.caution ? "studio.flight.touch.master_caution" : "studio.flight.touch.silence")}</b>
            </button>
          </div>
        {/if}
        <div class="row">
          <button type="button" class="key word" class:lit={status.gear === "down"} class:moving={status.gear === "moving"}
            tabindex="-1" aria-pressed={status.gear !== "up"} on:click={act("gear")}>
            <b>{$_("studio.flight.touch.gear")}</b>
          </button>
          <span class="flaps" class:lit={status.flaps > 0} class:moving={status.flapsMoving}>
            <button type="button" class="key word" tabindex="-1" aria-label={$_("studio.flight.touch.flaps_in")}
              disabled={status.flaps <= 0} on:click={act("flapsIn")}><b>−</b></button>
            <span><b>{$_("studio.flight.touch.flaps")}</b> <output>{status.flaps >= FLAPS_MOST ? $_("studio.flight.flaps.full") : status.flaps}</output></span>
            <button type="button" class="key word" tabindex="-1" aria-label={$_("studio.flight.touch.flaps_out")}
              on:click={act("flapsOut")}><b>+</b></button>
          </span>
          <button type="button" class="key word" class:lit={status.spoilers !== "in"} tabindex="-1"
            aria-label={$_("studio.flight.keys.speedbrake")} on:click={act("speedbrake")}>
            <b>{$_("studio.flight.touch.speedbrake")}</b>
          </button>
          <button type="button" class="key word" class:lit={status.autopilot} tabindex="-1" aria-pressed={status.autopilot}
            aria-label={$_("studio.flight.keys.autopilot")} on:click={act("autopilot")}>
            <b>{$_("studio.flight.touch.autopilot")}</b>
          </button>
          <!-- The view, from the cockpit to outside and on: in reach without unfolding the rest. -->
          <button type="button" class="key view" tabindex="-1" title={$_("studio.flight.keys.view")}
            aria-label={$_("studio.flight.keys.view")} on:click={act("view")}>
            <Icon icon={faEye} />
          </button>
          <button type="button" class="key toggle" tabindex="-1" aria-expanded={more}
            aria-label={$_(more ? "studio.flight.touch.less" : "studio.flight.touch.more")} on:click={() => { more = !more; }}>
            <Icon icon={more ? faChevronDown : faChevronUp} />
          </button>
        </div>
      </div>

      {#if tiltRefused}
        <p class="said" role="status">{$_("studio.flight.touch.tilt_refused")}</p>
      {:else if portrait && !$sidewaysTurn}
        {#if canFullscreen && !$fullscreen}
          <button type="button" class="said turn" tabindex="-1" on:click={toggleFullscreen}>
            <Icon icon={faRotate} /> {$_("studio.flight.touch.turn_fullscreen")}
          </button>
        {:else}
          <p class="said turn"><Icon icon={faRotate} /> {$_("studio.flight.touch.turn")}</p>
        {/if}
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* Over the view and the deck's readouts, under its questions. Nothing of
     it takes the pointer but the controls themselves: the view between them
     is still the eye's to turn. */
  .touch {
    --thumb: 60px;
    --edge-left: max(14px, calc(var(--mc-safe-left) + 6px));
    --edge-right: max(18px, calc(var(--mc-safe-right) + 8px));
    --edge-bottom: max(14px, calc(var(--mc-safe-bottom) + 4px));
    position: absolute;
    inset: 0;
    color: #f2f4f7;
    font: 600 11px/1 var(--mc-font);
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  .lever, .rudder, .stick, .hold, .key, .handle, button.said {
    pointer-events: auto;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  /* The glass the flying controls are made of: darker than the strip's, to
     be found against cloud, and never blurred: they are on screen all flight. */
  .lever, .rudder, .stick, .hold, .handle {
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(8, 12, 18, 0.34);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
  }

  /* The left thumb's: the lever, the two buttons held beside it, the rudder under both. */
  .left {
    position: absolute;
    left: var(--edge-left);
    bottom: var(--edge-bottom);
    display: grid;
    grid-template-columns: var(--thumb) var(--thumb);
    gap: 10px 12px;
    align-items: end;
  }
  .lever {
    position: relative;
    width: var(--thumb);
    height: clamp(128px, 39vh, 220px);
    height: clamp(128px, 39cqh, 220px);
    border-radius: 16px;
    overflow: hidden;
  }
  .lever .fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(rgba(255, 159, 10, 0.5), rgba(255, 159, 10, 0.16));
  }
  .lever.reverse .fill { background: rgba(255, 179, 64, 0.2); }
  /* The notch at idle, and what is under it. */
  .lever .notch {
    position: absolute;
    left: 6px;
    right: 6px;
    height: 0;
    margin-bottom: 16px;
    border-top: 1px dashed rgba(255, 255, 255, 0.5);
  }
  .lever .idle, .lever .rev {
    position: absolute;
    left: 0;
    right: 0;
    color: rgba(255, 255, 255, 0.62);
    font: 700 9px/1 var(--mc-font);
    letter-spacing: 0.06em;
    text-align: center;
    pointer-events: none;
  }
  .lever .idle { margin-bottom: 20px; }
  .lever .rev { bottom: 5px; }
  .lever.reverse .rev { color: #ffb340; }
  .lever .grip {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 0;
    display: grid;
    place-items: center;
    height: 32px;
    border-radius: 12px;
    background: rgba(244, 246, 248, 0.9);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4), inset 0 -2px 0 rgba(0, 0, 0, 0.14);
    color: rgba(20, 26, 34, 0.72);
    font: 700 9px/1 var(--mc-font);
    letter-spacing: 0.08em;
    will-change: transform;
  }
  .lever.held .grip { background: #fff; }

  .holds { display: grid; gap: 10px; }
  .hold {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 3px;
    width: var(--thumb);
    height: 46px;
    padding: 0;
    border-radius: 16px;
    color: inherit;
    font: 700 11px/1 var(--mc-font);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .hold :global(svg) { width: 13px; height: 13px; }
  .hold.brake { height: var(--thumb); }
  .hold.held { border-color: transparent; background: var(--mc-orange); color: #1a1205; }

  .rudder {
    grid-column: 1 / -1;
    position: relative;
    display: grid;
    place-items: center;
    height: 46px;
    border-radius: var(--mc-radius-pill);
  }
  /* Which way it goes, either side of the knob at rest. */
  .rudder::before, .rudder::after {
    position: absolute;
    top: 50%;
    color: rgba(255, 255, 255, 0.5);
    font: 700 11px/1 var(--mc-font);
    transform: translateY(-50%);
  }
  .rudder::before { content: "◀"; left: 12px; }
  .rudder::after { content: "▶"; right: 12px; }
  .rudder .knob {
    position: absolute;
    top: 3px;
    left: calc(50% - 26px);
    display: grid;
    place-items: center;
    width: 52px;
    height: 38px;
    border-radius: var(--mc-radius-pill);
    background: rgba(244, 246, 248, 0.9);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    color: rgba(20, 26, 34, 0.72);
    font: 700 9px/1 var(--mc-font);
    letter-spacing: 0.08em;
    will-change: transform;
  }
  .rudder.held .knob { background: #fff; }

  /* The right thumb's: the stick. */
  .stick {
    position: absolute;
    right: var(--edge-right);
    bottom: calc(var(--edge-bottom) + 6px);
    display: grid;
    place-items: center;
    width: 148px;
    height: 148px;
    border-radius: 50%;
  }
  /* A cross through the middle: which way is which. */
  .stick::before, .stick::after {
    content: "";
    position: absolute;
    background: rgba(255, 255, 255, 0.16);
  }
  .stick::before { top: 14px; bottom: 14px; left: 50%; width: 1px; }
  .stick::after { left: 14px; right: 14px; top: 50%; height: 1px; }
  .stick .knob {
    position: relative;
    z-index: 1;
    width: 62px;
    height: 62px;
    border-radius: 50%;
    background: rgba(244, 246, 248, 0.9);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
    will-change: transform;
  }
  .stick.held .knob { background: #fff; }
  .stick.tilting { border-color: var(--mc-orange); }

  /* What the other keys do: low in the middle, between the thumbs. */
  .strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--edge-bottom);
    display: grid;
    gap: 2px;
    width: max-content;
    max-width: calc(100% - 16px);
    box-sizing: border-box;
    margin: 0 auto;
    padding: 3px;
    border-radius: 18px;
    pointer-events: auto;
    touch-action: none;
  }
  .row { display: flex; justify-content: center; gap: 2px; }
  .key {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    min-width: 44px;
    height: 44px;
    padding: 0 6px;
    border: 0;
    border-radius: 14px;
    background: none;
    color: var(--mc-text);
    font: 600 9px/1 var(--mc-font);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .key :global(svg) { width: 15px; height: 15px; }
  .key:active { background: var(--mc-tint-hover); }
  .key:disabled { opacity: 0.4; }
  .key.word { min-width: 48px; padding: 0 9px; }
  .key b { font: 700 11px/1 var(--mc-font); letter-spacing: 0.06em; text-transform: uppercase; }
  .key.lit { background: color-mix(in srgb, var(--mc-orange) 26%, transparent); color: var(--mc-orange); }
  .key.word.lit { background: rgba(61, 220, 132, 0.2); color: #3ddc84; }
  .key.word.moving { background: rgba(255, 69, 58, 0.2); color: #ff6259; }
  .key.toggle { min-width: 40px; color: var(--mc-text-2); }
  /* The master light's button, as the glareshield's: red and flashing for a warning, amber for a caution. */
  .key.master { flex: 1; background: rgba(255, 69, 58, 0.24); color: #ff6259; animation: master 0.5s steps(2, start) infinite; }
  .key.master.caution { background: rgba(255, 179, 64, 0.22); color: #ffb340; animation: none; }
  @keyframes master { to { background: rgba(255, 69, 58, 0.08); } }
  @media (prefers-reduced-motion: reduce) {
    .key.master { animation: none; }
  }
  /* The flaps: in a step, where the lever is, out a step. */
  .flaps { display: flex; align-items: center; border-radius: 14px; background: var(--mc-tint); color: var(--mc-text); }
  .flaps > span { display: grid; justify-items: center; gap: 4px; min-width: 38px; }
  .flaps > span b { font: 700 9px/1 var(--mc-font); letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
  .flaps output { font: 700 13px/1 var(--mc-font); font-variant-numeric: tabular-nums; }
  .flaps .key.word { min-width: 44px; padding: 0; }
  .flaps .key b { font-size: 17px; }
  .flaps.lit output { color: #3ddc84; }
  .flaps.moving output { color: #7fd4ff; }

  /* Something said over the strip: to turn the phone, or that it cannot be a yoke. */
  .said {
    position: absolute;
    left: 50%;
    top: max(22%, 96px);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(78%, 420px);
    margin: 0;
    padding: 9px 16px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.72);
    color: #f2f4f7;
    font: 600 13px/1.25 var(--mc-font);
    text-align: left;
    transform: translateX(-50%);
  }
  .said :global(svg) { flex: none; width: 14px; height: 14px; color: var(--mc-orange); }

  /* The clean view: nothing drawn but the way back; the controls still fly, and show under a thumb. */
  .handle {
    position: absolute;
    left: 50%;
    bottom: var(--edge-bottom);
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    color: inherit;
    opacity: 0.4;
    transform: translateX(-50%);
  }
  .handle :global(svg) { width: 16px; height: 16px; }
  .touch.clean :is(.lever, .rudder, .stick, .hold) { opacity: 0; transition: opacity 0.2s; }
  .touch.clean :is(.lever, .rudder, .stick, .hold).held { opacity: 0.4; }

  /* A tablet's thumbs are no larger, but there is room to find the controls by. */
  @container mc-frame (min-width: 1000px) and (min-height: 700px) {
    .touch { --thumb: 68px; }
    .stick { width: 172px; height: 172px; }
    .stick .knob { width: 70px; height: 70px; }
  }

  /* Held upright there is no room between the thumbs: the strip goes over them. */
  @container mc-frame (orientation: portrait) and (max-width: 700px) {
    .strip { bottom: calc(var(--edge-bottom) + clamp(128px, 39cqh, 220px) + 78px); }
    .stick { width: 132px; height: 132px; }
  }
  /* A small phone on its side: a little less of the stick and of each button, for the strip to fit between the thumbs. */
  @container mc-frame (max-width: 720px) and (orientation: landscape) {
    .stick { width: 132px; height: 132px; }
    .stick .knob { width: 56px; height: 56px; }
    .rare .key { min-width: 40px; padding: 0 3px; }
  }
  /* Too narrow for the rarer buttons in one row: two rows of four. */
  @container mc-frame (max-width: 440px) {
    .rare { flex-wrap: wrap; }
    .rare .key { flex: 1 0 22%; }
  }
</style>
