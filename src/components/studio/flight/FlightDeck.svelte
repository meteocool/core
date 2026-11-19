<script lang="ts">
/**
 * The flight deck: what is drawn over the 3D map while the reader flies
 * (lib/studio/flight). In place of Studio's panel and timeline.
 *
 * The aircraft itself is the map's to draw (layers/aircraftLayer.ts): its
 * cockpit round the eye, or all of it from outside. This is what goes over
 * that: a few readouts in the corners, the warnings, the keys, and the
 * surface the mouse turns the eye by. V steps through the cockpit, the view
 * from outside, and a clean one with no aircraft and nothing over it, for
 * footage.
 *
 * The cockpit's screens and lights are drawn here (cockpitScreens.ts), each
 * onto a canvas that the map stretches over its place on the model.
 *
 * Everything that moves each frame is drawn from the pilot's telemetry in a
 * callback (`Pilot.onFrame`), straight onto canvases and element styles;
 * the markup follows only `flightStatus`, which changes now and then.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { faRightFromBracket } from "@fortawesome/free-solid-svg-icons/faRightFromBracket";
import { faVolumeXmark } from "@fortawesome/free-solid-svg-icons/faVolumeXmark";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import Icon from "../../Icon.svelte";
import FlightKeys from "./FlightKeys.svelte";
import CloseDisc from "../../CloseDisc.svelte";
import Segmented from "../../Segmented.svelte";
import type { InspectMode } from "../../../lib/studio/director";
import { FEET, KNOTS, radarColour } from "./instruments";
import { CockpitScreens } from "./cockpitScreens";
import { cloudsTime } from "../../../stores";
import { MARKS_SHOWN } from "../../../lib/studio/flight/marks";
import type { Pilot, Telemetry } from "../../../lib/studio/flight/pilot";
import { flightStatus, studioFlightOnly } from "../../../lib/studio/store";
import { fullscreen, fullscreenSupported } from "../../../lib/fullscreen";
import { flightMuted } from "../../../lib/studio/flight/sound";

export let pilot: Pilot;
/** The credits the map shows, which the deck shows in its place. */
export let credits: () => string;

/* The cockpit's screens and lights: never in the page, only on the model. */
const cockpit = new CockpitScreens();
pilot.setScreens(cockpit.screens);

let fade: HTMLDivElement | null = null;
let throttle: HTMLOutputElement | null = null;
/* The storms marked in the view (lib/studio/flight/marks.ts): as many labels
   as the view ever carries, each put where its storm is every frame, and
   out of sight where there is none for it. */
const MARKS = Array.from({ length: MARKS_SHOWN }, (_unused, index) => index);
let marks: Array<HTMLElement | null> = MARKS.map(() => null);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** The ways of looking into a marked storm, as the chooser offers them. */
const INSPECT: InspectMode[] = ["cut", "peel", "xray"];

function drawMarks(telemetry: Telemetry): void {
  marks.forEach((element, index) => {
    if (!element) return;
    const seen = telemetry.marks[index];
    if (!seen) {
      if (element.style.opacity !== "0") {
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
      }
      return;
    }
    element.style.pointerEvents = "auto";
    const { mark } = seen;
    element.style.transform = `translate(${(seen.x * element.parentElement!.clientWidth).toFixed(1)}px, ${(seen.y * element.parentElement!.clientHeight).toFixed(1)}px)`;
    // Fainter the further off: the near ones are the ones to read.
    element.style.opacity = seen.inspected ? "1" : (0.92 - 0.5 * Math.min(1, seen.distance / 220_000)).toFixed(2);
    element.classList.toggle("target", seen.target);
    element.classList.toggle("inspected", seen.inspected);
    element.style.setProperty("--mark", radarColour(mark.peakDbz) ?? "#fff");
    const [name, detail] = element.querySelectorAll("span");
    write(name as HTMLElement, `${Math.round(mark.peakDbz)} dBZ${mark.hail ? ` · ${hail}` : ""}`);
    const parts = [`${(seen.distance / 1852).toFixed(0)} NM`];
    if (mark.top !== null) parts.push(`${tops} FL${String(Math.round((mark.top * FEET) / 1000) * 10).padStart(3, "0")}`);
    if (mark.strikes) parts.push(`⚡ ${mark.strikes}`);
    if (mark.heading !== null && mark.speed !== null && mark.speed > 1) {
      // A storm is said by where it goes, as its motion on the map is.
      parts.push(`${COMPASS[Math.round(mark.heading / 45) % 8]} ${Math.round(mark.speed * KNOTS)} kt`);
    }
    write(detail as HTMLElement, parts.join(" · "));
  });
}

/** Whether the browser puts a page over the whole screen: the disc beside the way out. */
const canFullscreen = fullscreenSupported();

let readouts: Record<"speed" | "altitude" | "heading" | "target" | "air" | "frames" | "radio" | "rolled", HTMLElement | null> = {
  speed: null, altitude: null, heading: null, target: null, air: null, frames: null, radio: null, rolled: null,
};

/** How a landing went, by how fast it came down, m/s: up to 120, 300 and 600 ft a minute, and harder. */
const landingGrade = (sink: number) => (sink < 0.6 ? "butter" : sink < 1.5 ? "smooth" : sink < 3 ? "firm" : "hard");
const FLAP_NAMES = ["0", "1", "2", "3"];

let attribution = credits();
const creditsTimer = setInterval(() => { attribution = credits(); }, 3000);

$: status = $flightStatus;
$: hail = $_("studio.flight.mark.hail");
$: tops = $_("studio.flight.mark.tops");

/** Write a text only when it changed: most frames it has not. */
function write(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function frame(telemetry: Telemetry): void {
  const { state } = telemetry;
  if (fade) fade.style.opacity = String(telemetry.fade);
  if (status.view === "clean") return;
  if (status.view === "cockpit") cockpit.draw(telemetry, { status, scan: $cloudsTime.shown ?? $cloudsTime.newest });
  write(throttle, `${Math.round(state.throttle * 100)}%`);
  write(readouts.speed, `${Math.round(telemetry.ias * KNOTS)} kt · M${telemetry.mach.toFixed(2)}`);
  const feet = state.altitude * FEET;
  write(readouts.altitude, `${Math.round(feet / 10) * 10} ft · FL${String(Math.round(feet / 100)).padStart(3, "0")}`);
  // Low down, how high over the ground: to the ten feet, and to the foot for the last fifty.
  const over = (telemetry.radarAltitude ?? 0) * FEET;
  write(readouts.radio, `${over < 50 ? Math.round(over) : Math.round(over / 10) * 10} ft`);
  write(readouts.rolled, `${Math.round(telemetry.rolled / 10) * 10} m`);
  write(readouts.heading, `${String(Math.round(state.heading) % 360).padStart(3, "0")}°`);
  const { target } = telemetry;
  // How far, and how long at this speed: no time for an aircraft standing still, or as good as.
  const minutes = target && target.seconds < 6 * 3600
    ? ` · ${Math.floor(target.seconds / 60)}:${String(Math.floor(target.seconds % 60)).padStart(2, "0")}` : "";
  write(readouts.target, target ? `${(target.distance / 1852).toFixed(0)} NM${minutes}` : "–");
  // The air outside, and what it is doing: its temperature, and how fast it is carrying the aircraft up or down.
  const draft = Math.round((telemetry.draft * 196.85) / 100) * 100;
  write(readouts.air, `${Math.round(telemetry.temperature)} °C${Math.abs(draft) >= 300 ? ` · ${draft > 0 ? "↑" : "↓"} ${Math.abs(draft)} fpm` : ""}`);
  // How fast the flight is drawn, and at what share of its sharpness where it has had to give some up.
  write(readouts.frames, `${Math.round(telemetry.fps)} fps${telemetry.quality < 0.99 ? ` · ${Math.round(telemetry.quality * 100)}%` : ""}`);
  drawMarks(telemetry);
}

/* The mouse turns the eye: a drag anywhere on the view, the head in its
   seat or the eye round the aircraft; twice clicked, it looks ahead again;
   the wheel stands it nearer or further off, outside. */
let turning = false;
function pointerdown(event: PointerEvent): void {
  if (event.button !== 0) return;
  turning = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function pointermove(event: PointerEvent): void {
  if (turning) pilot.lookBy(event.movementX, event.movementY);
}
function pointerup(): void {
  turning = false;
}
function wheel(event: WheelEvent): void {
  event.preventDefault();
  pilot.zoomBy(Math.sign(event.deltaY));
}

let unlisten: (() => void) | null = null;
onMount(() => {
  unlisten = pilot.onFrame(frame);
});
onDestroy(() => {
  unlisten?.();
  pilot.setScreens([]);
  cockpit.dispose();
  clearInterval(creditsTimer);
});

const WARNINGS = {
  terrain: "studio.flight.terrain", stall: "studio.flight.stall", overspeed: "studio.flight.overspeed", ice: "studio.flight.ice",
  gear: "studio.flight.gear_low", sink: "studio.flight.sink",
} as const;
</script>

<div class="flight-deck view-{status.view}" aria-label={$_("studio.flight.aria")} role="region">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="look"
    class:turning
    title={$_("studio.flight.look_title")}
    on:pointerdown={pointerdown}
    on:pointermove={pointermove}
    on:pointerup={pointerup}
    on:pointercancel={pointerup}
    on:dblclick={() => pilot.recentre()}
    on:wheel={wheel}></div>

  {#if status.view !== "clean"}
    <div class="marks">
      {#each MARKS as index (index)}
        <button type="button" class="mark" tabindex="-1" title={$_("studio.flight.inspect.mark_title")}
          bind:this={marks[index]} on:click={() => pilot.inspect(index)}><i></i><span></span><span></span></button>
      {/each}
    </div>
    <dl class="readouts">
      <div class="corner-nw"><dt>{$_("studio.flight.readout.speed")}</dt><dd bind:this={readouts.speed}></dd></div>
      <div class="corner-ne" class:beside-screen={canFullscreen}>
        <dt>{$_("studio.flight.readout.altitude")}</dt><dd bind:this={readouts.altitude}></dd>
        <!-- Low down the height over the ground reads out with it; hidden, not gone, so the frame has somewhere to write. -->
        <dt hidden={!status.low || status.onGround}>{$_("studio.flight.readout.radio")}</dt>
        <dd hidden={!status.low || status.onGround} bind:this={readouts.radio}></dd>
      </div>
      <div class="corner-sw">
        <dt>{$_("studio.flight.readout.heading")}</dt><dd bind:this={readouts.heading}></dd>
        <dt>{$_("studio.flight.readout.air")}</dt><dd bind:this={readouts.air}></dd>
        <dt>{$_("studio.flight.readout.frames")}</dt><dd bind:this={readouts.frames}></dd>
      </div>
      <div class="corner-se">
        <dt>{$_("studio.flight.readout.target")}</dt><dd bind:this={readouts.target}></dd>
        <dt>THR</dt><dd><output class="throttle" bind:this={throttle} aria-label={$_("studio.flight.throttle")}>0%</output></dd>
        {#if status.reverse}
          <dt>{$_("studio.flight.reverse")}</dt><dd class="surface out">REV</dd>
        {/if}
        {#if status.flaps > 0 || status.flapsMoving}
          <!-- Where the lever is; lit while the flaps are still on their way there. -->
          <dt>{$_("studio.flight.flaps.label")}</dt>
          <dd class="surface" class:moving={status.flapsMoving} aria-label={$_("studio.flight.flaps.label")}>
            {FLAP_NAMES[status.flaps] ?? $_("studio.flight.flaps.full")}
          </dd>
        {/if}
        {#if status.spoilers !== "in"}
          <dt>{$_("studio.flight.spoilers.label")}</dt>
          <dd class="surface out">{$_(`studio.flight.spoilers.${status.spoilers}`)}</dd>
        {/if}
        {#if status.gear !== "up"}
          <!-- The landing gear, as the panel shows it: three greens down and locked, three reds on the way; nothing up. -->
          <dt>{$_("studio.flight.gear.label")}</dt>
          <dd class="gear {status.gear}" role="img" aria-label={$_(`studio.flight.gear.${status.gear}`)}><i></i><i></i><i></i></dd>
        {/if}
      </div>
    </dl>
  {/if}

  <div class="alerts" role="status">
    {#if status.crash}
      <p class="warning steady">{$_(`studio.flight.crash.${status.crash}`)}</p>
    {/if}
    {#each status.warnings as warning (warning)}
      <p class="warning">{$_(WARNINGS[warning])}</p>
    {/each}
    {#if status.alphaFloor && status.view !== "clean"}
      <p class="note caution">{$_("studio.flight.alpha_floor")}</p>
    {/if}
    {#if status.clearSky && status.view !== "clean"}
      <p class="note">{$_("studio.flight.clear_sky")}</p>
    {/if}
    {#if status.paused}
      <p class="note">{$_("studio.flight.paused")}</p>
    {/if}
  </div>

  {#if status.keys && status.view !== "clean"}
    <FlightKeys />
  {/if}

  {#if status.landing && status.view !== "clean"}
    <!-- A landing, as it was made: how hard, how fast, and how far it has rolled. -->
    <section class="landing glass glass-tray" aria-label={$_("studio.flight.landing.title")}>
      <h2>{$_(status.landing.stopped ? "studio.flight.landing.title" : "studio.flight.landing.rolling")}
        <span class="grade {landingGrade(status.landing.sink)}">{$_(`studio.flight.landing.${landingGrade(status.landing.sink)}`)}</span></h2>
      <p>
        <b>−{Math.round((status.landing.sink * 196.85) / 10) * 10} fpm</b>
        <b>{Math.round(status.landing.speed * KNOTS)} kt</b>
        <b>{status.landing.load.toFixed(1)} g</b>
        <span>{$_("studio.flight.landing.rolled")} <b bind:this={readouts.rolled}></b></span>
      </p>
      {#if status.landing.stopped}
        <p class="again">{$_("studio.flight.landing.again")}</p>
      {/if}
    </section>
  {/if}

  {#if status.view !== "clean"}
    <div class="corner">
      {#if canFullscreen}
        <button type="button" class="leave full glass glass-pill" tabindex="-1" on:click={() => pilot.act("fullscreen")}
          title={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")}
          aria-label={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")} aria-pressed={$fullscreen}>
          <Icon icon={$fullscreen ? faCompress : faExpand} />
        </button>
      {/if}
      <button type="button" class="leave glass glass-pill" on:click={() => pilot.act("leave")}
        title={$_($studioFlightOnly ? "studio.flight.leave_title_plan" : "studio.flight.leave_title")}>
        <Icon icon={faRightFromBracket} /> {$_("studio.flight.leave")}
      </button>
    </div>
  {/if}
  {#if $flightMuted && status.view !== "clean"}
    <span class="muted" title={$_("studio.flight.muted_title")}><Icon icon={faVolumeXmark} /> {$_("studio.flight.muted")}</span>
  {/if}
  {#if status.inspecting && status.view !== "clean"}
    <div class="inspect glass glass-pill" role="group" aria-label={$_("studio.flight.inspect.title")}>
      <Segmented compact label={$_("studio.flight.inspect.title")}
        options={INSPECT.map((mode) => ({ value: mode, label: $_(`studio.flight.inspect.${mode}`) }))}
        value={status.inspecting} on:change={(event) => pilot.inspectAs(event.detail)} />
      <CloseDisc on:click={() => pilot.inspectAs(null)} />
    </div>
  {/if}
  {#if status.recording}
    <span class="rec" aria-hidden="true">REC</span>
  {/if}
  {#if status.leaving}
    <!-- Asked before a flight ends: Escape alone does not end one. -->
    <div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="flight-leave-title">
      <section class="glass glass-tray">
        <h2 id="flight-leave-title">{$_("studio.flight.leave_ask.title")}</h2>
        <p>{$_($studioFlightOnly ? "studio.flight.leave_ask.text_plan" : "studio.flight.leave_ask.text")}</p>
        <div class="choices">
          <button type="button" class="glass-pill" on:click={() => pilot.stay()}>{$_("studio.flight.leave_ask.stay")} <kbd>Esc</kbd></button>
          <button type="button" class="glass-pill end" on:click={() => pilot.leave()}>{$_("studio.flight.leave_ask.end")} <kbd>↵</kbd></button>
        </div>
      </section>
    </div>
  {/if}

  <p class="credits">{status.view === "clean" ? attribution : `${$_("studio.flight.model_credit")} | ${attribution}`}</p>
  <div class="fade" bind:this={fade} aria-hidden="true"></div>
</div>

<style>
  .flight-deck {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: #f2f4f7;
    font: 13px/1.3 var(--mc-font);
  }
  .flight-deck > :global(*) { pointer-events: none; }
  .fade {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
  }
  .fade { background: #000; }
  /* What the mouse turns the eye by: the whole view, under everything else here. */
  .flight-deck > .look {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }
  .flight-deck > .look.turning { cursor: grabbing; }

  /* The readouts: four in the corners, over the view. */
  .readouts { margin: 0; }
  .readouts > div {
    position: absolute;
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 10px;
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(5, 7, 10, 0.55);
    font-variant-numeric: tabular-nums;
  }
  .readouts dt { color: #9aa3ad; font: 600 11px/1.4 var(--mc-font); text-transform: uppercase; letter-spacing: 0.05em; }
  .readouts dd { margin: 0; font: 700 14px/1.3 var(--mc-font); }
  .readouts .throttle { color: inherit; font: inherit; }
  .readouts .gear { display: flex; align-items: center; gap: 4px; }
  .gear i {
    width: 0;
    height: 0;
    border: 6px solid transparent;
    border-top: 9px solid #3ddc84;
    border-bottom-width: 0;
  }
  .gear.moving i { border-top-color: #ff453a; }
  .surface { color: #3ddc84; }
  .surface.moving { color: #7fd4ff; }
  .surface.out { color: #ffb340; }

  /* The landing, as it was made: low in the middle, out of the way of the view ahead. */
  .landing {
    position: absolute;
    left: 50%;
    bottom: 84px;
    padding: 10px 16px 12px;
    color: var(--mc-text);
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .landing h2 { margin: 0 0 6px; font: var(--mc-type-heading); }
  .landing p { display: flex; gap: 14px; justify-content: center; margin: 0; font: 600 13px/1.3 var(--mc-font); }
  .landing .again { margin-top: 8px; color: var(--mc-text-2); font-weight: 500; }
  .grade {
    margin-left: 8px;
    padding: 2px 8px;
    border-radius: var(--mc-radius-pill);
    font: 700 11px/1.4 var(--mc-font);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .grade.butter, .grade.smooth { background: rgba(61, 220, 132, 0.25); color: #3ddc84; }
  .grade.firm { background: rgba(255, 179, 64, 0.25); color: #ffb340; }
  .grade.hard { background: rgba(255, 69, 58, 0.25); color: #ff453a; }
  .corner-nw { top: 16px; left: 16px; }
  .corner-ne { top: 16px; right: 120px; }
  /* Clear of the whole-screen disc as well, where there is one. */
  .corner-ne.beside-screen { right: 162px; }
  .corner-sw { bottom: 32px; left: 16px; }
  .corner-se { bottom: 32px; right: 16px; }

  /* A storm's mark: a small diamond over it on a thin stem, and two lines of
     small print beside it. Quiet: it is a note on the view, not part of it. */
  .marks { position: absolute; inset: 0; overflow: hidden; }
  .mark {
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 7px;
    align-items: center;
    width: max-content;
    margin: -5px 0 0 -5px;
    opacity: 0;
    color: #fff;
    font: 600 11px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.85), 0 1px 1px rgba(0, 0, 0, 0.6);
    transition: opacity 0.25s;
    will-change: transform;
  }
  .mark i {
    grid-row: 1 / span 2;
    position: relative;
    width: 8px;
    height: 8px;
    border: 1.5px solid var(--mark, #fff);
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
    transform: rotate(45deg);
  }
  /* The stem, down towards the storm: from the diamond's lower corner, fading. */
  .mark i::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 100%;
    width: 1px;
    height: 44px;
    background: linear-gradient(rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0));
    transform: rotate(-45deg);
    transform-origin: top left;
  }
  /* A faint plate behind each line: the label is white, and so is the cloud it floats over. */
  .mark span {
    justify-self: start;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(8, 12, 18, 0.34);
  }
  .mark span:last-child { font-weight: 500; opacity: 0.85; }
  /* A button, to look into its storm; drawn as the note it is. */
  .mark {
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    pointer-events: none;
  }
  .mark:hover i, .mark.inspected i { background: color-mix(in srgb, var(--mark, #fff) 55%, transparent); }
  .mark.inspected i { box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), 0 0 3px rgba(0, 0, 0, 0.7); }

  /* How the storm looked into is opened: a small bar, low and in the middle. */
  .flight-deck > .inspect {
    position: absolute;
    left: 50%;
    bottom: 34px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 6px;
    transform: translateX(-50%);
    pointer-events: auto;
    /* Over the view the bar's writing is light in either theme: the chosen one's lens is a lighter glass, not a white card. */
    --mc-sheet-card: rgba(255, 255, 255, 0.26);
  }
  .flight-deck > .inspect :global(*) { pointer-events: auto; }
  .mark.target i { border-color: #ff4fd8; }
  .mark.target span:first-of-type { color: #ffc2f1; }

  .alerts {
    position: absolute;
    top: 13%;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateX(-50%);
  }
  .alerts p { margin: 0; }
  .warning {
    padding: 6px 16px;
    border: 2px solid #ff453a;
    border-radius: 6px;
    background: rgba(10, 0, 0, 0.6);
    color: #ff453a;
    font: 800 20px/1 var(--mc-font);
    letter-spacing: 0.08em;
    white-space: pre;
    animation: blink 0.9s steps(2, start) infinite;
  }
  .note {
    padding: 6px 14px;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.6);
    font: 600 13px/1.2 var(--mc-font);
  }
  /* The question before a flight ends: over everything, the view dimmed behind it. */
  .ask {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(5, 7, 10, 0.45);
    pointer-events: auto;
  }
  .ask section { max-width: 340px; padding: 18px 20px; color: var(--mc-text); text-align: center; }
  .ask h2 { margin: 0 0 6px; font: var(--mc-type-heading); }
  .ask p { margin: 0 0 14px; color: var(--mc-text-2); font: 13px/1.4 var(--mc-font); }
  .ask .choices { display: flex; gap: 10px; justify-content: center; }
  .ask button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: var(--mc-pill-h);
    padding: 0 14px;
    border: 1px solid color-mix(in srgb, var(--mc-text) 25%, transparent);
    background: transparent;
    color: var(--mc-text);
    font: 600 13px/1 var(--mc-font);
    cursor: pointer;
    pointer-events: auto;
  }
  .ask button.end { border-color: transparent; background: var(--mc-accent); color: #fff; }
  .ask button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .ask kbd { opacity: 0.7; font: 600 11px/1 var(--mc-font); }
  .warning.steady { animation: none; letter-spacing: 0.02em; white-space: normal; }
  .note.caution { color: #ffb340; font-weight: 700; }
  @keyframes blink { to { visibility: hidden; } }
  @media (prefers-reduced-motion: reduce) {
    .warning { animation: none; }
  }

  /* The way out and the whole screen, side by side in the corner. */
  .corner {
    position: absolute;
    top: 14px;
    right: 14px;
    display: flex;
    gap: 8px;
  }
  .leave.full { width: var(--mc-pill-h); padding: 0; justify-content: center; }
  .leave {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-pill-h);
    padding: 0 12px;
    border: 0;
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    cursor: pointer;
    pointer-events: auto !important;
  }
  .leave :global(svg) { width: 12px; height: 12px; }
  .leave:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .rec {
    position: absolute;
    top: 20px;
    left: 50%;
    padding: 4px 10px;
    border-radius: var(--mc-radius-pill);
    background: #ff453a;
    color: #fff;
    font: 700 11px/1 var(--mc-font);
    transform: translateX(-50%);
  }
  /* The sound off, M: small, under the way out, as it stays for the flight. */
  .muted {
    position: absolute;
    top: calc(22px + var(--mc-pill-h));
    right: 14px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.55);
    color: #c9d0d8;
    font: 600 11px/1 var(--mc-font);
  }
  .muted :global(svg) { width: 11px; height: 11px; }
  .credits {
    position: absolute;
    right: 8px;
    bottom: 3px;
    max-width: 70%;
    margin: 0;
    overflow: hidden;
    color: rgba(255, 255, 255, 0.72);
    font: 10px/1.3 var(--mc-font);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
  }
</style>
