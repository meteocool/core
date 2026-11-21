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
import { faVolumeHigh } from "@fortawesome/free-solid-svg-icons/faVolumeHigh";
import { faQuestion } from "@fortawesome/free-solid-svg-icons/faQuestion";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import Icon from "../../Icon.svelte";
import FlightKeys from "./FlightKeys.svelte";
import TouchControls from "./TouchControls.svelte";
import FlightMinimap from "./FlightMinimap.svelte";
import CloseDisc from "../../CloseDisc.svelte";
import Segmented from "../../Segmented.svelte";
import type { InspectMode } from "../../../lib/studio/director";
import { FEET, KNOTS, radarColour } from "./instruments";
import { CockpitScreens } from "./cockpitScreens";
import { cloudsTime } from "../../../stores";
import { MARKS_SHOWN } from "../../../lib/studio/flight/marks";
import type { Pilot, Telemetry } from "../../../lib/studio/flight/pilot";
import { COCKPIT_CONTROLS } from "../../../lib/studio/flight/cockpit";
import { kindOf, masterLights } from "../../../lib/studio/flight/alarms";
import type { CockpitControl, CockpitPick } from "../../../lib/studio/flight/cockpit";
import { flightStatus, studioFlightOnly } from "../../../lib/studio/store";
import { fullscreen, fullscreenSupported } from "../../../lib/fullscreen";
import { shareAvailable, shareIcon } from "../../../lib/shareSupport";
import { flightMuted } from "../../../lib/studio/flight/sound";
import { touchCapable, touchControls } from "../../../lib/studio/flight/touch";
import { frameDelta, pointWithin } from "../../../lib/sideways";

export let pilot: Pilot;
/** The credits the map shows, which the deck shows in its place. */
export let credits: () => string;
/** Send the link to this flight's start, from the control asked with; none where there is no way to. */
export let share: ((anchor: Element | null) => void) | null = null;
/** Whether ending the flight goes back to the map it was asked from ("Fly from here"), not to Studio or the plan. */
export let endsOnMap = false;

/* The cockpit's screens and lights: never in the page, only on the model. */
const cockpit = new CockpitScreens();
pilot.setScreens(cockpit.screens);

let fade: HTMLDivElement | null = null;
/* The map of the flight, which only the view from outside has: there is no navigation display to look at there. */
let minimap: FlightMinimap | null = null;
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
  if (status.view === "cockpit") cockpit.draw(telemetry, { status, scan: $cloudsTime.shown ?? $cloudsTime.newest, brakes: pilot.brakes });
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
  minimap?.draw(telemetry);
}

/* The mouse turns the eye: a drag anywhere on the view, the head in its
   seat or the eye round the aircraft; twice clicked, it looks ahead again;
   the wheel stands it nearer or further off, outside, and looks closer
   from the seat.

   From the seat the mouse is also the hand on the flight deck's own
   controls (lib/studio/flight/cockpit.ts). Over one, a note beside it says
   what it is, how it stands and what a hand does there. A press that goes
   nowhere is a click: a lever moved, a button pushed. And the stick, the
   pedals and the thrust levers are held: they are the mouse's from the
   press to its release, and it is they that move, not the eye. */
let turning = false;
/** A press under way: where it began, how far it has gone since, and whether it took hold of a control. */
let pressed: { x: number; y: number; moved: number; holding: boolean } | null = null;
/** Where the mouse is over the view, and the control of the flight deck it is over there. */
let pointer: { x: number; y: number } | null = null;
let over: CockpitPick | null = null;
let note: HTMLElement | null = null;
/** A press that goes no further than this is a click, CSS pixels. */
const CLICK_PX = 4;

/** What kind of hand a control takes, for the pointer over it: a click, or what it holds. */
$: hand = over && !turning ? (COCKPIT_CONTROLS[over.name] as CockpitControl).hold ?? "press" : null;

/** Where a mouse's event is in the view, CSS pixels from its top left: in the picture as drawn, on its side in the apps (lib/sideways.ts). */
function within(event: MouseEvent): [number, number] {
  return pointWithin(event, event.currentTarget as HTMLElement);
}

function pointerdown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const [x, y] = within(event);
  // A finger's moves on the view are the touch controls' to read (a look, a pinch), and never reach here: it holds
  // nothing, and whether it clicked is told from where it lifts. A second finger down is a pinch, and no click at all.
  const finger = event.pointerType === "touch";
  pressed = { x, y, moved: finger && pressed ? Infinity : 0, holding: !finger && pilot.hold(x, y) };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function pointermove(event: PointerEvent): void {
  const [x, y] = within(event);
  pointer = { x, y };
  if (!pressed) {
    point();
  } else if (pressed.holding) {
    pilot.moveHeld(x - pressed.x, y - pressed.y);
  } else {
    const [dx, dy] = frameDelta(event.movementX, event.movementY);
    pressed.moved += Math.abs(dx) + Math.abs(dy);
    if (!turning && pressed.moved <= CLICK_PX) return;
    turning = true;
    over = null;
    pilot.lookBy(dx, dy);
  }
}
function pointerup(event: PointerEvent): void {
  const press = pressed;
  pressed = null;
  if (press && event.pointerType === "touch") {
    const [x, y] = within(event);
    press.moved += Math.abs(x - press.x) + Math.abs(y - press.y);
  }
  if (press?.holding) pilot.release();
  else if (press && !turning && press.moved <= CLICK_PX && event.type === "pointerup") pilot.press(press.x, press.y);
  turning = false;
  // A finger lifted is over nothing; a mouse is still where it was.
  if (event.pointerType !== "mouse") pointer = null;
  point();
}
function pointerleave(): void {
  if (pressed) return;
  pointer = null;
  point();
}
function dblclick(event: MouseEvent): void {
  // Twice on a control is two clicks on it, not a look ahead.
  if (!pilot.controlAt(...within(event))) pilot.recentre();
  point();
}
function wheel(event: WheelEvent): void {
  event.preventDefault();
  pilot.zoomBy(Math.sign(event.deltaY));
  point();
}

/**
 * Look again for the control under the mouse, and say what it is: the mouse
 * has moved, or the view has under it. Every frame as well, as a lever
 * under the mouse may be moving. A control held stays the one.
 */
function point(): void {
  if (!pressed) {
    const found = pointer ? pilot.controlAt(pointer.x, pointer.y) : null;
    // The markup follows the control, not every pixel across it: only the lever's two halves do different things.
    const same = (a: CockpitPick | null, b: CockpitPick | null) => a?.name === b?.name && a?.face === b?.face
      && (a?.down ?? 0) < 0.5 === (b?.down ?? 0) < 0.5;
    if (!same(found, over)) over = found;
  }
  say();
}

/** How the control under the mouse stands, if that is something to say, and what a hand does there. */
function told(pick: CockpitPick): [string | null, string] {
  const t = (key: string) => $_(`studio.flight.cockpit.${key}`);
  const onOff = (on: boolean) => t(on ? "on" : "off");
  const side = pick.face === 0 ? "left" : "right";
  switch (pick.name) {
    case "flaps": return [FLAP_NAMES[status.flaps] ?? $_("studio.flight.flaps.full"), t(pick.down < 0.5 ? "flaps.in" : "flaps.out")];
    case "speedBrake": return [status.spoilers === "in" ? t("speedBrake.in") : $_(`studio.flight.spoilers.${status.spoilers}`), t("speedBrake.hint")];
    case "gear": return [t(`gear.${status.gear}`), t(status.onGround ? "gear.ground" : "gear.hint")];
    case "thrust": return [
      `${Math.round(pilot.telemetry.state.throttle * 100)}%${status.reverse ? " · REV" : ""}`, t(status.onGround ? "thrust.ground" : "thrust.hint"),
    ];
    case "sidestick": return [null, t("sidestick.hint")];
    case "pedals": return [null, t(`pedals.${side}`)];
    case "rudderTrim": return [null, t(`rudderTrim.${side}`)];
    case "autopilot": return [onOff(status.autopilot), t(status.onGround ? "autopilot.ground" : "autopilot.hint")];
    case "autobrake": return [pilot.brakes.autobrake ? t("autobrake.armed") : t("off"), t("autobrake.hint")];
    case "parkingBrake": return [pilot.brakes.parking ? t("parkingBrake.set") : t("off"), t(status.onGround ? "parkingBrake.hint" : "parkingBrake.air")];
    case "masterWarning":
    case "masterCaution": {
      const lit = masterLights(status.alarms, status.silenced)[pick.name === "masterWarning" ? "warning" : "caution"];
      return [lit ? t("masterWarning.lit") : t("off"), t("masterWarning.hint")];
    }
    default: return [onOff(status.radarOnGround), t("weatherRadar.hint")];
  }
}

/** Write the note and put it beside the mouse, clear of the view's edge. */
function say(): void {
  if (!note) return;
  const shown = over !== null && pointer !== null && status.view === "cockpit";
  note.hidden = !shown;
  if (!over || !pointer || !shown) return;
  const [state, does] = told(over);
  const [title, hint] = note.children as unknown as [HTMLElement, HTMLElement];
  write(title, `${$_(`studio.flight.cockpit.${over.name}.name`)}${state === null ? "" : ` · ${state}`}`);
  write(hint, does);
  const deck = note.parentElement!;
  const [width, height] = [note.offsetWidth, note.offsetHeight];
  const left = pointer.x + 18 + width > deck.clientWidth ? pointer.x - 12 - width : pointer.x + 18;
  const top = pointer.y + 22 + height > deck.clientHeight ? pointer.y - 12 - height : pointer.y + 22;
  note.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
onMount(() => pilot.onFrame(point));

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
  gear: "studio.flight.gear_low", sink: "studio.flight.sink", bank: "studio.flight.bank",
  flapsJammed: "studio.flight.flaps_jammed", gearJammed: "studio.flight.gear_jammed",
} as const;
</script>

<div class="flight-deck view-{status.view}" class:inspecting={status.inspecting !== null} class:touch={$touchControls} aria-label={$_("studio.flight.aria")} role="region">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="look"
    class:turning
    data-hand={hand}
    title={over ? undefined : $_("studio.flight.look_title")}
    on:pointerdown={pointerdown}
    on:pointermove={pointermove}
    on:pointerup={pointerup}
    on:pointercancel={pointerup}
    on:pointerleave={pointerleave}
    on:dblclick={dblclick}
    on:wheel={wheel}></div>
  <!-- What the mouse is over on the flight deck, from the seat: written and placed as it moves (`say`). -->
  <p class="hand-note" bind:this={note} role="tooltip" hidden><b></b><span></span></p>

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
    {#if status.lost.length && !status.crash}
      <!-- What has come off the aircraft, in the order it went: outside, the one place it is said besides the cockpit's alarms. -->
      <p class="warning" class:silenced={status.lost.every((part) => status.silenced.includes(`lost.${part}`))}>
        {$_("studio.flight.lost.title", { values: { parts: status.lost.map((part) => $_(`studio.flight.lost.${part}`)).join(", ") } })}
      </p>
    {/if}
    {#each status.warnings as warning (warning)}
      <!-- A caution in amber; one the reader has silenced stays, dimmed and still. -->
      <p class="warning" class:caution={kindOf(warning).level === "caution"} class:silenced={status.silenced.includes(warning)}>{$_(WARNINGS[warning])}</p>
    {/each}
    {#if status.alphaFloor && status.view !== "clean"}
      <p class="note caution">{$_("studio.flight.alpha_floor")}</p>
    {/if}
    {#if status.clearSky && status.view !== "clean"}
      <p class="note">{$_("studio.flight.clear_sky")}</p>
    {/if}
    {#if status.paused}
      <p class="note">{$_($touchControls ? "studio.flight.touch.paused" : "studio.flight.paused")}</p>
    {/if}
  </div>

  {#if status.keys && status.view !== "clean"}
    <FlightKeys />
  {:else if status.view === "outside"}
    <!-- Where the keys' card stands while that is up. -->
    <FlightMinimap {pilot} bind:this={minimap} />
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
        <p class="again">{$_($touchControls ? "studio.flight.touch.again" : "studio.flight.landing.again")}</p>
      {/if}
    </section>
  {/if}

  {#if status.view !== "clean"}
    <div class="corner">
      <!-- The controls, on a card: H, and the touch strip's ?, are the same. -->
      <button type="button" class="leave full glass glass-pill" tabindex="-1" on:click={() => pilot.act("help")}
        title={$_("studio.flight.help_title")} aria-label={$_("studio.flight.help")} aria-pressed={status.keys}>
        <Icon icon={faQuestion} />
      </button>
      <!-- The sound, the music's with it, on or off: M, and the menus' switch, are the same. -->
      <button type="button" class="leave full glass glass-pill" tabindex="-1" on:click={() => pilot.act("mute")}
        title={$_($flightMuted ? "studio.flight.sound.off_title" : "studio.flight.sound.on_title")}
        aria-label={$_("studio.flight.sound.on")} aria-pressed={!$flightMuted}>
        <Icon icon={$flightMuted ? faVolumeXmark : faVolumeHigh} />
      </button>
      {#if canFullscreen}
        <button type="button" class="leave full glass glass-pill" tabindex="-1" on:click={() => pilot.act("fullscreen")}
          title={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")}
          aria-label={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")} aria-pressed={$fullscreen}>
          <Icon icon={$fullscreen ? faCompress : faExpand} />
        </button>
      {/if}
      <button type="button" class="leave glass glass-pill" on:click={() => pilot.act("leave")}
        title={$_(endsOnMap ? "studio.flight.leave_title_map" : $studioFlightOnly ? "studio.flight.leave_title_plan" : "studio.flight.leave_title")}>
        <Icon icon={faRightFromBracket} /> {$_("studio.flight.leave")}
      </button>
    </div>
  {/if}
  {#if $flightMuted && status.view !== "clean"}
    <span class="muted" title={$_("studio.flight.muted_title")}><Icon icon={faVolumeXmark} /> {$_("studio.flight.muted")}</span>
  {/if}
  {#if status.inspecting && status.view !== "clean"}
    <div class="inspect glass glass-pill" role="group" aria-label={$_("studio.flight.inspect.title")}>
      <Segmented label={$_("studio.flight.inspect.title")}
        options={INSPECT.map((mode) => ({ value: mode, label: $_(`studio.flight.inspect.${mode}`) }))}
        value={status.inspecting} on:change={(event) => pilot.inspectAs(event.detail)} />
      <CloseDisc on:click={() => pilot.inspectAs(null)} />
    </div>
  {/if}
  {#if status.recording}
    <span class="rec" aria-hidden="true">REC</span>
  {/if}
  {#if touchCapable()}
    <!-- A phone's stick, lever and buttons: over the readouts, under the question below. -->
    <TouchControls {pilot} />
  {/if}
  {#if status.leaving}
    <!-- Asked before a flight ends: Escape alone does not end one. -->
    <div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="flight-leave-title">
      <section class="glass glass-tray">
        <h2 id="flight-leave-title">{$_("studio.flight.leave_ask.title")}</h2>
        <p>{$_(endsOnMap ? "studio.flight.leave_ask.text_map" : $studioFlightOnly ? "studio.flight.leave_ask.text_plan" : "studio.flight.leave_ask.text")}</p>
        <div class="choices">
          <button type="button" class="glass-pill" on:click={() => pilot.stay()}>{$_("studio.flight.leave_ask.stay")} <kbd>Esc</kbd></button>
          <button type="button" class="glass-pill end" on:click={() => pilot.leave()}>{$_("studio.flight.leave_ask.end")} <kbd>↵</kbd></button>
        </div>
        {#if share && $shareAvailable}
          <!-- The link to where this flight began, while it is held: the start it took off from, not where it has got to. -->
          <button type="button" class="share" on:click={(event) => share?.(event.currentTarget)}>
            <Icon icon={shareIcon()} /> {$_("studio.flight.share.flight")}
          </button>
        {/if}
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
  /* Over a control of the flight deck: a finger for one that is clicked or pushed, and the way the others are dragged. */
  .flight-deck > .look[data-hand="press"], .flight-deck > .look[data-hand="rudder"] { cursor: pointer; }
  .flight-deck > .look[data-hand="thrust"] { cursor: ns-resize; }
  .flight-deck > .look[data-hand="stick"] { cursor: move; }
  /* The note beside the mouse: the control's name and how it stands, and under it what a hand does there. */
  .hand-note {
    position: absolute;
    top: 0;
    left: 0;
    margin: 0;
    padding: 6px 10px 7px;
    border-radius: 8px;
    background: rgba(5, 7, 10, 0.8);
    font: 500 12px/1.4 var(--mc-font);
    white-space: nowrap;
    will-change: transform;
  }
  .hand-note b { display: block; font-weight: 700; font-variant-numeric: tabular-nums; }
  .hand-note span { color: #c9d0d8; }

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
  /* Every top clear of the status bar, a phone's clock and all, where there is one. */
  .corner-nw { top: calc(var(--mc-safe-top) + 16px); left: 16px; }
  .corner-ne { top: calc(var(--mc-safe-top) + 16px); right: 204px; }
  /* Clear of the whole-screen disc as well, where there is one. */
  .corner-ne.beside-screen { right: 246px; }
  .corner-sw { bottom: 32px; left: 16px; }
  .corner-se { bottom: 32px; right: 16px; }

  /* The map of the flight, from outside: on the left over the readouts there, clear of the corners and the middle. */
  .flight-deck > :global(.flight-minimap) {
    position: absolute;
    left: 16px;
    bottom: 124px;
  }
  /* A low window has less room between its corners. */
  @container mc-frame (max-height: 560px) {
    .flight-deck > :global(.flight-minimap) { --flight-minimap-size: 144px; }
  }

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

  /* How the storm looked into is opened: a bar at the top, in the middle, large enough to hit while flying. */
  .flight-deck > .inspect {
    position: absolute;
    top: calc(var(--mc-safe-top) + 14px);
    left: 50%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 8px;
    transform: translateX(-50%);
    pointer-events: auto;
    /* Over the view the bar's writing is light in either theme: the chosen one's lens is a lighter glass, not a white card. */
    --mc-sheet-card: rgba(255, 255, 255, 0.26);
  }
  .flight-deck > .inspect :global(*) { pointer-events: auto; }
  .flight-deck > .inspect :global(.segmented button) {
    height: 40px;
    padding: 0 20px;
    font-size: 16px;
    font-weight: 600;
  }
  /* The warnings and a recording's mark stand clear of it. */
  .flight-deck.inspecting .alerts { top: max(13%, calc(var(--mc-safe-top) + 84px)); }
  .flight-deck.inspecting .rec { top: calc(var(--mc-safe-top) + 78px); }
  /* In a window too narrow for it between the speed and the altitude, it goes under them. */
  @container mc-frame (max-width: 1100px) {
    .flight-deck > .inspect { top: calc(var(--mc-safe-top) + 60px); }
    .flight-deck.inspecting .alerts { top: max(13%, calc(var(--mc-safe-top) + 130px)); }
    .flight-deck.inspecting .rec { top: calc(var(--mc-safe-top) + 124px); }
  }
  .mark.target i { border-color: #ff4fd8; }
  .mark.target span:first-of-type { color: #ffc2f1; }

  .alerts {
    position: absolute;
    top: max(13%, calc(var(--mc-safe-top) + 56px));
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
  /* Quieter than the answers: a link-like line under them. */
  .ask button.share { margin: 12px auto 0; height: auto; padding: 4px 8px; border: 0; color: var(--mc-text-2); font-size: 12px; }
  .ask button.share:hover { color: var(--mc-text); }
  .ask button.share :global(svg) { width: 11px; height: 11px; }
  .warning.steady { animation: none; letter-spacing: 0.02em; white-space: normal; }
  .warning.caution { border-color: #ffb340; background: rgba(10, 6, 0, 0.6); color: #ffb340; }
  .warning.silenced { opacity: 0.45; animation: none; }
  .note.caution { color: #ffb340; font-weight: 700; }
  @keyframes blink { to { visibility: hidden; } }
  @media (prefers-reduced-motion: reduce) {
    .warning { animation: none; }
  }

  /* The way out and the whole screen, side by side in the corner. */
  .corner {
    position: absolute;
    top: calc(var(--mc-safe-top) + 14px);
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
    top: calc(var(--mc-safe-top) + 20px);
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
    top: calc(var(--mc-safe-top) + 22px + var(--mc-pill-h));
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

  /* Flown by touch (TouchControls.svelte), the foot of the screen is the
     thumbs': the stick on the right, the lever on the left, the strip of
     buttons between them. What stood there stands along the top instead, and
     inside whatever a phone's screen cuts off its corners and its edges. */
  .flight-deck.touch {
    --deck-left: max(16px, calc(var(--mc-safe-left) + 6px));
    --deck-right: max(14px, calc(var(--mc-safe-right) + 6px));
    --deck-top: max(12px, calc(var(--mc-safe-top) + 4px));
  }
  .flight-deck.touch .corner-nw { top: var(--deck-top); left: var(--deck-left); }
  .flight-deck.touch .corner-sw { top: var(--deck-top); bottom: auto; left: calc(var(--deck-left) + 180px); }
  .flight-deck.touch .corner-ne { top: var(--deck-top); right: calc(var(--deck-right) + 190px); }
  .flight-deck.touch .corner-ne.beside-screen { right: calc(var(--deck-right) + 232px); }
  .flight-deck.touch .corner-se { top: calc(var(--deck-top) + 46px); bottom: auto; right: var(--deck-right); }
  .flight-deck.touch .corner { top: calc(var(--deck-top) - 2px); right: var(--deck-right); }
  /* The strip's own button says whether the sound is off. */
  .flight-deck.touch .muted { display: none; }
  /* Over the strip, opened or not. */
  .flight-deck.touch .landing { bottom: calc(max(14px, var(--mc-safe-bottom)) + 112px); }
  /* The credits between the thumbs, under the strip. */
  .flight-deck.touch .credits { right: auto; left: 50%; max-width: 46%; text-align: center; transform: translateX(-50%); }
  /* The map from outside: under the readouts on the left, over the lever. */
  .flight-deck.touch > :global(.flight-minimap) {
    top: calc(var(--deck-top) + 112px);
    bottom: auto;
    left: var(--deck-left);
  }
  /* No keys to answer with. */
  .flight-deck.touch .ask kbd { display: none; }
  .flight-deck.touch .ask button { height: 44px; padding: 0 18px; }
  .flight-deck.touch .leave { height: 36px; }
  .flight-deck.touch .leave.full { width: 36px; }

  /* A phone: less of everything, and only what a flight is flown by. */
  @container mc-frame (max-height: 520px) or (max-width: 560px) {
    .flight-deck.touch .readouts > div { gap: 1px 8px; padding: 5px 9px; }
    .flight-deck.touch .readouts dt { font-size: 10px; }
    .flight-deck.touch .readouts dd { font-size: 13px; }
    /* The heading stays; the air outside and the frames a second are a desk's to read. */
    .flight-deck.touch .corner-sw :is(dt, dd):nth-of-type(n + 2) { display: none; }
    .flight-deck.touch .corner-sw { left: calc(var(--deck-left) + 160px); }
    .flight-deck.touch > :global(.flight-minimap) { --flight-minimap-size: 104px; top: calc(var(--deck-top) + 46px); }
  }
  /* On its side there is no room left between the top row's readouts. */
  @container mc-frame (max-height: 520px) {
    .flight-deck.touch .warning { padding: 5px 12px; font-size: 16px; }
    .flight-deck.touch .landing { padding: 8px 12px 9px; }
    .flight-deck.touch .landing p { gap: 10px; font-size: 12px; }
    /* Under the top row, which has no room left between its readouts. */
    .flight-deck.touch > .inspect { top: calc(var(--deck-top) + 44px); gap: 6px; padding: 4px 6px; }
    .flight-deck.touch > .inspect :global(.segmented button) { height: 34px; padding: 0 14px; font-size: 14px; }
    .flight-deck.touch.inspecting .alerts { top: calc(var(--deck-top) + 96px); }
  }
  /* Held upright, the top row is two: the heading goes under the speed. */
  @container mc-frame (max-width: 560px) {
    .flight-deck.touch .corner-sw { top: calc(var(--deck-top) + 46px); left: var(--deck-left); }
    .flight-deck.touch .corner-ne, .flight-deck.touch .corner-ne.beside-screen { top: calc(var(--deck-top) + 46px); right: var(--deck-right); }
    .flight-deck.touch .corner-se { top: calc(var(--deck-top) + 92px); }
    .flight-deck.touch > :global(.flight-minimap) { top: calc(var(--deck-top) + 92px); }
    .flight-deck.touch .alerts { top: calc(var(--deck-top) + 150px); }
    .flight-deck.touch > .inspect { top: calc(var(--deck-top) + 100px); }
  }
</style>
