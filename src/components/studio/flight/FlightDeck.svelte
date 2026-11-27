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
import { faQuestion } from "@fortawesome/free-solid-svg-icons/faQuestion";
import { faGear } from "@fortawesome/free-solid-svg-icons/faGear";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons/faRotateRight";
import { CUT_PUSH_KM, CUT_TURN_STEP } from "../../../lib/studio/flight/cut";
import { dbzColour } from "../../../lib/cellVolume";
import { STYLE_FIELD } from "../../../lib/cloudStyle";
import { radarColormap } from "../../../stores";
import Icon from "../../Icon.svelte";
import FlightKeys from "./FlightKeys.svelte";
import FlightSettings from "./FlightSettings.svelte";
import TouchControls from "./TouchControls.svelte";
import FlightMinimap from "./FlightMinimap.svelte";
import FlightHorizon from "./FlightHorizon.svelte";
import CloseDisc from "../../CloseDisc.svelte";
import Segmented from "../../Segmented.svelte";
import type { InspectMode } from "../../../lib/studio/director";
import { FEET, KNOTS, radarColour } from "./instruments";
import { CockpitScreens } from "./cockpitScreens";
import { cloudsTime } from "../../../stores";
import { MARKS_SHOWN } from "../../../lib/studio/flight/marks";
import { RAYS_MOST } from "../../../lib/studio/flight/radarRays";
import { drawRays } from "./rays";
import type { Pilot, Telemetry } from "../../../lib/studio/flight/pilot";
import { COCKPIT_CONTROLS } from "../../../lib/studio/flight/cockpit";
import { kindOf, masterLights } from "../../../lib/studio/flight/alarms";
import type { CockpitControl, CockpitPick } from "../../../lib/studio/flight/cockpit";
import { flightStatus, studioFlightOnly } from "../../../lib/studio/store";
import { fullscreen, fullscreenSupported } from "../../../lib/fullscreen";
import { shareAvailable, shareIcon } from "../../../lib/shareSupport";
import { flightMuted } from "../../../lib/studio/flight/sound";
import MusicIcon from "./MusicIcon.svelte";
import { touchCapable, touchControls } from "../../../lib/studio/flight/touch";
import { frameDelta, pointWithin } from "../../../lib/sideways";
import type { BoardDeck } from "./board/meteoairBoard";

export let pilot: Pilot;
/** The credits the map shows, which the deck shows in its place. */
export let credits: () => string;
/** Send the link to this flight's start, from the control asked with; none where there is no way to. */
export let share: ((anchor: Element | null) => void) | null = null;
/** Whether ending the flight goes back to the map it was asked from ("Fly from here"), not to Studio or the plan. */
export let endsOnMap = false;
/** The flight on meteoair's board, for a flight that is on one (board/meteoairBoard.ts): its parts of the deck come with it. */
export let board: BoardDeck | null = null;

/* The cockpit's screens and lights: never in the page, only on the model. */
const cockpit = new CockpitScreens();
pilot.setScreens(cockpit.screens);

let fade: HTMLDivElement | null = null;
/* The map of the flight, which only the view from outside has: there is no navigation display to look at there. */
let minimap: FlightMinimap | null = null;
/* Which way is up, from outside, beside the map: the seat has its own on the panel. */
let horizon: FlightHorizon | null = null;
let throttle: HTMLOutputElement | null = null;
/* The storms marked in the view (lib/studio/flight/marks.ts): as many labels
   as the view ever carries, each put where its storm is every frame, and
   out of sight where there is none for it. */
const MARKS = Array.from({ length: MARKS_SHOWN }, (_unused, index) => index);
let marks: Array<HTMLElement | null> = MARKS.map(() => null);
/* The beams from the radars that saw the storm looked into (./rays.ts), and a label at each radar's end. */
let rays: HTMLCanvasElement | null = null;
const RADARS = Array.from({ length: RAYS_MOST }, (_unused, index) => index);
let radars: Array<HTMLElement | null> = RADARS.map(() => null);
let beamsDrawn = false;
/* Whether the settings' card is up (FlightSettings.svelte). */
let settingsOpen = false;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** The ways of looking into a marked storm, as the chooser offers them. */
const INSPECT: InspectMode[] = ["cut", "peel", "xray"];

/** The peel slider's track: the radar's colours from the faintest echo a peeled storm shows to its core, which a full peel leaves. */
function peelTrack(coreDbz: number, colormap: string): string {
  const floor = STYLE_FIELD.cloud.floor;
  const top = Math.max(coreDbz, floor);
  return `linear-gradient(to right, ${Array.from({ length: 10 }, (_unused, i) => {
    const [r, g, b] = dbzColour(floor + ((top - floor) * i) / 9, colormap);
    return `rgb(${r}, ${g}, ${b}) ${(i / 9) * 100}%`;
  }).join(", ")})`;
}

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

/**
 * The beams to the storm looked into, and the radars' names at their far
 * ends. The beams end on the storm's diamond, which is measured off its
 * label rather than worked out, since the label's layout puts it there.
 */
function drawBeams(telemetry: Telemetry): void {
  // Nothing to do while no storm is looked into, once the last beams have been cleared away.
  if (!rays || (!telemetry.rays && !beamsDrawn)) return;
  beamsDrawn = telemetry.rays !== null;
  const box = rays.getBoundingClientRect();
  const index = telemetry.marks.findIndex((seen) => seen.inspected);
  const seen = telemetry.marks[index];
  const shape = index >= 0 ? marks[index]?.querySelector("i")?.getBoundingClientRect() : null;
  const diamond = shape ? { x: shape.left + shape.width / 2 - box.left, y: shape.top + shape.height / 2 - box.top } : null;
  const anchor = seen ? { x: seen.x * box.width, y: seen.y * box.height } : null;
  drawRays(rays, telemetry.rays, telemetry.time, diamond, anchor);
  const beams = telemetry.rays?.beams ?? [];
  const grown = telemetry.rays ? telemetry.rays.still || telemetry.time - telemetry.rays.since > 0.9 : false;
  radars.forEach((element, slot) => {
    if (!element) return;
    const beam = beams[slot];
    if (!beam?.dish || !grown) {
      if (element.style.opacity !== "0") element.style.opacity = "0";
      return;
    }
    element.style.opacity = (0.55 + 0.45 * beam.radar.strength).toFixed(2);
    element.style.transform = `translate(${(beam.dish.x * box.width).toFixed(1)}px, ${(beam.dish.y * box.height).toFixed(1)}px)`;
    const [name, detail] = element.querySelectorAll("span");
    write(name as HTMLElement, beam.radar.name);
    const level = String(Math.round((beam.radar.beamKm * 1000 * FEET) / 1000) * 10).padStart(3, "0");
    write(detail as HTMLElement, rayDetail(Math.round((beam.radar.distanceKm * 1000) / 1852), `FL${level}`));
  });
}

/** Whether the browser puts a page over the whole screen: the disc beside the way out. */
const canFullscreen = fullscreenSupported();

let readouts: Record<"speed" | "altitude" | "heading" | "target" | "air" | "frames" | "radio" | "rolled" | "score" | "best", HTMLElement | null> = {
  speed: null, altitude: null, heading: null, target: null, air: null, frames: null, radio: null, rolled: null, score: null, best: null,
};
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** How a landing went, by how fast it came down, m/s: up to 120, 300 and 600 ft a minute, and harder. */
const landingGrade = (sink: number) => (sink < 0.6 ? "butter" : sink < 1.5 ? "smooth" : sink < 3 ? "firm" : "hard");
const FLAP_NAMES = ["0", "1", "2", "3"];

let attribution = credits();
const creditsTimer = setInterval(() => { attribution = credits(); }, 3000);
/**
 * The credits, on a card from the small "Licences" under the view, not
 * written across the view itself: the flight's own (the aircraft, the
 * thunder's recordings), the map's line as it is now, and the data sources
 * and their licences as the imprint lists them for every map
 * (imprint.html#data), read from that page as the card first opens, so the
 * two never differ. The flight is held while the card is up.
 */
let licencesOpen = false;
let dataLicences: string | null = null;
let dataLicencesFailed = false;
let pausedForLicences = false;
const IMPRINT = `${import.meta.env?.BASE_URL ?? "/"}imprint.html`;

/** The imprint's "Data sources and licences": its heading's section, up to the next heading of its rank, every link opening beside the flight. */
async function loadDataLicences(): Promise<void> {
  if (dataLicences !== null) return;
  dataLicencesFailed = false;
  try {
    const response = await fetch(IMPRINT);
    if (!response.ok) throw new Error(`${response.status}`);
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const heading = page.getElementById("data");
    if (!heading) throw new Error("no #data");
    const section = page.createElement("div");
    for (let node = heading.nextElementSibling; node && node.tagName !== "H2" && node.tagName !== "HR"; node = node.nextElementSibling) {
      section.append(node.cloneNode(true));
    }
    for (const link of section.querySelectorAll("a")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) link.setAttribute("href", `${IMPRINT}${href}`);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
    }
    dataLicences = section.innerHTML;
  } catch {
    dataLicencesFailed = true;
  }
}

function openLicences(): void {
  licencesOpen = true;
  void loadDataLicences();
  pausedForLicences = !status.paused;
  if (pausedForLicences) pilot.act("pause");
}

function closeLicences(): void {
  licencesOpen = false;
  if (pausedForLicences && status.paused) pilot.act("pause");
  pausedForLicences = false;
}

/*
 * The top row's buttons and the readout beside them. The readout keeps
 * clear of however wide the buttons are (`cornerRoom`). Flown by touch on a
 * phone held on its side whose screen is cut by a notch or an island
 * (`sides`), the small round buttons go into the strips either side of the
 * view, beside where the camera is, above it: only the way out stays in the
 * top row, and the readouts have the room.
 */
let deck: HTMLDivElement | null = null;
let insetProbe: HTMLDivElement | null = null;
let cornerWidth = 0;
let outWidth = 0;
let sides = false;
/** How wide a strip beside the view has to be to hold a button, CSS pixels: a notch's or an island's, not a rounded corner's. */
const SIDE_STRIP = 40;
function measureSides(): void {
  if (!insetProbe) return;
  const style = getComputedStyle(insetProbe);
  sides = parseFloat(style.paddingLeft) >= SIDE_STRIP && parseFloat(style.paddingRight) >= SIDE_STRIP;
}
$: cornerRoom = Math.max(cornerWidth, outWidth) + 10;

/*
 * Over a desk's view (not under a finger, whose places the stylesheet
 * gives), where the top's readouts go, from how wide each is drawn: the
 * speed on the left and the altitude between it and the buttons where they
 * fit side by side; in a narrower window the altitude under the buttons,
 * and in one narrower still the speed as well. The cards (the board, the
 * settings, the keys) and the alerts under them stand in the middle, as
 * high as they can without covering any of those.
 */
const EDGE = 16;
const ROW = 14;
const GAP = 10;
/** The cards' and alerts' highest place, CSS pixels under the status bar: where the alerts always stood. */
const POPUPS_TOP = 56;
let deckWidth = 0;
let cornerHeight = 0;
let nwWidth = 0;
let nwHeight = 0;
let neWidth = 0;
let neHeight = 0;
let popupsWidth = 0;
let mutedWidth = 0;
let mutedHeight = 0;
$: rowBottom = ROW + cornerHeight + GAP;
$: nwUnder = nwWidth > 0 && EDGE + nwWidth + GAP > deckWidth - ROW - cornerWidth;
$: nwTop = nwUnder ? rowBottom : EDGE;
$: neBeside = !nwUnder && EDGE + nwWidth + GAP + neWidth <= deckWidth - ROW - cornerRoom;
$: neTop = neBeside ? EDGE
  : EDGE + nwWidth + GAP + neWidth + ROW <= deckWidth ? Math.max(rowBottom, nwTop) : Math.max(rowBottom, nwTop + nwHeight + GAP);
$: neRight = neBeside ? ROW + cornerRoom : ROW;
/* The sound's "off" under the buttons, or under the altitude where that is under them. */
$: mutedTop = neBeside ? ROW + cornerHeight + 8 : neTop + neHeight + 8;
$: popupsTop = status.view === "clean" ? POPUPS_TOP : [
  [deckWidth - ROW - cornerWidth, deckWidth - ROW, ROW + cornerHeight],
  [EDGE, EDGE + nwWidth, nwTop + nwHeight],
  [deckWidth - neRight - neWidth, deckWidth - neRight, neTop + neHeight],
  ...($flightMuted ? [[deckWidth - ROW - mutedWidth, deckWidth - ROW, mutedTop + mutedHeight]] : []),
].reduce((top, [left, right, bottom]) => (
  left < (deckWidth + popupsWidth) / 2 + GAP && right > (deckWidth - popupsWidth) / 2 - GAP ? Math.max(top, bottom + GAP) : top
), POPUPS_TOP);
let sidesObserver: ResizeObserver | null = null;
onMount(() => {
  measureSides();
  if (typeof ResizeObserver !== "undefined" && deck) {
    sidesObserver = new ResizeObserver(measureSides);
    sidesObserver.observe(deck);
  }
});
onDestroy(() => sidesObserver?.disconnect());

$: status = $flightStatus;
$: hail = $_("studio.flight.mark.hail");
$: tops = $_("studio.flight.mark.tops");
/* How a radar saw the storm: how far from it, and how high its lowest beam is over it. */
function rayDetail(distance: number, level: string): string {
  return $_("studio.flight.ray.detail", { values: { distance, level } });
}

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
  const { score } = telemetry;
  write(readouts.score, `${points.format(Math.floor(score.points))}${score.rate ? ` · +${score.rate}/s` : ""}`);
  readouts.score?.classList.toggle("earning", score.rate > 0);
  write(readouts.best, points.format(Math.floor(telemetry.best)));
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
  drawBeams(telemetry);
  minimap?.draw(telemetry);
  horizon?.draw(telemetry);
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

<div class="flight-deck view-{status.view}" class:inspecting={status.inspecting !== null} class:cutting={(status.cut !== null || status.peel !== null) && status.view !== "clean"} class:touch={$touchControls} class:sides={sides && $touchControls} class:fullscreen-able={canFullscreen}
  style:--corner-room={`${cornerRoom}px`} style:--nw-top={`${nwTop}px`} style:--ne-top={`${neTop}px`} style:--ne-right={`${neRight}px`}
  style:--muted-top={`${mutedTop}px`} style:--popups-top={`${popupsTop}px`}
  bind:this={deck} bind:clientWidth={deckWidth} aria-label={$_("studio.flight.aria")} role="region">
  <!-- Measures the strips a notch or an island cuts off either side (`sides`). -->
  <div class="inset-probe" aria-hidden="true" bind:this={insetProbe}></div>
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
      <!-- Drawn every frame, and nothing to point at: what is under it is the storms' marks and the map. -->
      <canvas class="rays" bind:this={rays} aria-hidden="true"></canvas>
      {#each RADARS as index (index)}
        <div class="radar" bind:this={radars[index]} aria-hidden="true"><i></i><span></span><span></span></div>
      {/each}
      {#each MARKS as index (index)}
        <button type="button" class="mark" tabindex="-1" title={$_("studio.flight.inspect.mark_title")}
          bind:this={marks[index]} on:click={() => pilot.inspect(index)}><i></i><span></span><span></span></button>
      {/each}
    </div>
    {#if board}
      <!-- The callsigns over the other aircraft near, from the board's airspace. -->
      <svelte:component this={board.Labels} {board} {pilot} />
    {/if}
    <dl class="readouts">
      <div class="corner-nw" class:boarded={board !== null} bind:clientWidth={nwWidth} bind:clientHeight={nwHeight}>
        <dt>{$_("studio.flight.readout.speed")}</dt><dd bind:this={readouts.speed}></dd>
        <!-- The score: earned in a storm's cloud, faster the stronger its echo, and lit while it is; and the best flown here. -->
        <dt class="score">{$_("studio.flight.readout.score")}</dt><dd class="score" bind:this={readouts.score}></dd>
        {#if board}
          <!-- Beside it, the board's, which counts. -->
          <svelte:component this={board.Readout} {board} />
        {/if}
        <dt class="best">{$_("studio.flight.readout.best")}</dt><dd class="best" bind:this={readouts.best}></dd>
      </div>
      <div class="corner-ne" class:beside-screen={canFullscreen} bind:clientWidth={neWidth} bind:clientHeight={neHeight}>
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

  {#if status.view === "outside"}
    <FlightMinimap {pilot} traffic={board?.traffic ?? null} bind:this={minimap} />
    <FlightHorizon bind:this={horizon} />
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
    <div class="corner" bind:clientWidth={cornerWidth} bind:clientHeight={cornerHeight}>
      <!-- The controls, on a card: H is the same; under a finger, the only way to them. -->
      <button type="button" class="leave full help glass glass-pill" tabindex="-1" on:click={() => pilot.act("help")}
        title={$_("studio.flight.help_title")} aria-label={$_("studio.flight.help")} aria-pressed={status.keys}>
        <Icon icon={faQuestion} />
      </button>
      <!-- What the reader chooses to see while flying, kept for every flight. -->
      <button type="button" class="leave full settings glass glass-pill" tabindex="-1" on:click={() => { settingsOpen = !settingsOpen; }}
        title={$_("studio.flight.settings.title")} aria-label={$_("studio.flight.settings.title")} aria-pressed={settingsOpen}>
        <Icon icon={faGear} />
      </button>
      {#if $touchControls}
        <!-- Under a finger the foot of the screen is the thumbs': the credits' way in is up here, under the settings. -->
        <button type="button" class="licences-link in-corner" tabindex="-1" aria-haspopup="dialog" aria-expanded={licencesOpen}
          on:click={() => (licencesOpen ? closeLicences() : openLicences())}>{$_("studio.flight.licences")}</button>
      {/if}
      <!-- The music on or off, the flight's own sounds staying: M, and the menus' switch, are the same. -->
      <button type="button" class="leave full music glass glass-pill" tabindex="-1" on:click={() => pilot.act("mute")}
        title={$_($flightMuted ? "studio.flight.sound.off_title" : "studio.flight.sound.on_title")}
        aria-label={$_("studio.flight.sound.on")} aria-pressed={!$flightMuted}>
        <MusicIcon off={$flightMuted} />
      </button>
      {#if share && $shareAvailable}
        <!-- This moment of the flight as a link: the flight is held while it is sent. -->
        <button type="button" class="leave full share glass glass-pill" tabindex="-1" on:click={(event) => share?.(event.currentTarget)}
          title={$_("studio.flight.share.moment_title")} aria-label={$_("studio.flight.share.moment")}>
          <Icon icon={shareIcon()} />
        </button>
      {/if}
      {#if canFullscreen}
        <button type="button" class="leave full screen glass glass-pill" tabindex="-1" on:click={() => pilot.act("fullscreen")}
          title={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")}
          aria-label={$_($fullscreen ? "studio.flight.fullscreen_exit" : "studio.flight.fullscreen")} aria-pressed={$fullscreen}>
          <Icon icon={$fullscreen ? faCompress : faExpand} />
        </button>
      {/if}
      <button type="button" class="leave out glass glass-pill" bind:clientWidth={outWidth} on:click={() => pilot.act("leave")}
        title={$_(endsOnMap ? "studio.flight.leave_title_map" : $studioFlightOnly ? "studio.flight.leave_title_plan" : "studio.flight.leave_title")}>
        <Icon icon={faRightFromBracket} /> {$_("studio.flight.leave")}
      </button>
    </div>
  {/if}
  {#if $flightMuted && status.view !== "clean"}
    <span class="muted" bind:clientWidth={mutedWidth} bind:clientHeight={mutedHeight} title={$_("studio.flight.muted_title")}><MusicIcon off /> {$_("studio.flight.muted")}</span>
  {/if}
  {#if status.inspecting && status.view !== "clean"}
    <div class="inspect glass glass-pill" class:cutting={status.cut !== null || status.peel !== null} role="group" aria-label={$_("studio.flight.inspect.title")}>
      <div class="modes">
        <Segmented label={$_("studio.flight.inspect.title")}
          options={INSPECT.map((mode) => ({ value: mode, label: $_(`studio.flight.inspect.${mode}`) }))}
          value={status.inspecting} on:change={(event) => pilot.inspectAs(event.detail)} />
        <CloseDisc on:click={() => pilot.inspectAs(null)} />
      </div>
      {#if status.cut}
        <!-- The cut is drawn where it stands (an orange sheet); here it is moved, as a section plane in Studio is. -->
        <div class="cut-set" role="group" aria-label={$_("studio.flight.inspect.cut_set")}>
          <button type="button" class="turn" title={$_("studio.flight.inspect.cut_left")} aria-label={$_("studio.flight.inspect.cut_left")}
            on:click={() => pilot.moveCut({ turnDeg: -CUT_TURN_STEP })}><Icon icon={faRotateLeft} /></button>
          <button type="button" class="turn" title={$_("studio.flight.inspect.cut_right")} aria-label={$_("studio.flight.inspect.cut_right")}
            on:click={() => pilot.moveCut({ turnDeg: CUT_TURN_STEP })}><Icon icon={faRotateRight} /></button>
          <label class="depth" title={$_("studio.flight.inspect.cut_depth_title")}>
            <span>{$_("studio.flight.inspect.cut_depth")}</span>
            <input type="range" min={-CUT_PUSH_KM} max={CUT_PUSH_KM} step="0.5" value={status.cut.pushKm}
              on:input={(event) => pilot.moveCut({ pushTo: Number(event.currentTarget.value) })} />
            <output>{status.cut.pushKm > 0 ? "+" : ""}{status.cut.pushKm.toFixed(1)} km</output>
          </label>
          <button type="button" class="face" title={$_("studio.flight.inspect.cut_face_title")}
            on:click={() => pilot.moveCut({ face: true })}>{$_("studio.flight.inspect.cut_face")}</button>
        </div>
      {/if}
      {#if status.peel}
        <!-- As the 3D map's own peel (PeelSlider.svelte): the track is the palette, from the faintest echo drawn to the storm's core. -->
        <label class="peel-set" title={$_("studio.flight.inspect.peel_title")}>
          <span>{$_("studio.flight.inspect.peel_level")}</span>
          <input type="range" min="0" max="1" step="0.01" value={status.peel.level} style:--track={peelTrack(status.peel.coreDbz, $radarColormap)}
            on:input={(event) => pilot.peelTo(Number(event.currentTarget.value))} />
          <output>{Math.round(status.peel.level * 100)}%</output>
        </label>
      {/if}
    </div>
  {/if}
  {#if status.recording}
    <span class="rec" aria-hidden="true">REC</span>
  {/if}
  {#if touchCapable()}
    <!-- A phone's stick, lever and buttons: over the readouts, under the question below. -->
    <TouchControls {pilot} />
  {/if}
  <!-- The cards and the alerts, in the middle under the top's readouts (`popupsTop`); under a finger each where it stands. -->
  <div class="popups" bind:clientWidth={popupsWidth}>
    {#if board && status.view !== "clean"}
      <!-- The day's board, on a card from the board's readout. -->
      <svelte:component this={board.Card} {board} />
    {/if}
    {#if settingsOpen && status.view !== "clean"}
      <FlightSettings close={() => { settingsOpen = false; }} />
    {/if}
    {#if status.keys && status.view !== "clean" && !$touchControls}
      <!-- Under a finger, shown on the controls themselves instead (TouchControls.svelte). -->
      <FlightKeys close={() => pilot.act("help")} />
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
      {:else if status.thrustLocked && status.view !== "clean"}
        <p class="note caution">{$_($touchControls ? "studio.flight.touch.thrust_locked" : "studio.flight.thrust_locked")}</p>
      {:else if status.speedHint && status.view !== "clean"}
        <!-- Near the speed limits: how to come off them, before the overspeed sounds or once it has. -->
        <p class="note caution">{$_(`studio.flight.speed_hint.${status.speedHint}${$touchControls ? "_touch" : ""}`)}</p>
      {/if}
      {#if status.clearSky && status.view !== "clean"}
        <p class="note">{$_("studio.flight.clear_sky")}</p>
      {/if}
      <!-- Under a finger the touch controls' own button says it, and resumes. -->
      {#if status.feat && status.view !== "clean"}
        <!-- A bonus earned: what for, and how much. -->
        {#key status.feat}
          <p class="note feat">{$_(`studio.flight.feat.${status.feat.feat}`)} · +{points.format(status.feat.points)}</p>
        {/key}
      {/if}
      {#if status.paused && !$touchControls}
        <p class="note">{$_("studio.flight.paused")}</p>
      {/if}
      {#if board && status.view !== "clean"}
        <svelte:component this={board.Note} {board} />
      {/if}
    </div>
    {#if board}
      <!-- The check the board may ask of the reader, in every view: unanswered, the flight is not on the board. -->
      <svelte:component this={board.Check} {board} />
    {/if}
  </div>
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
          <!-- The link to this moment of the flight, while it is held: where it has got to, and all of the aircraft as it is. -->
          <button type="button" class="share" on:click={(event) => share?.(event.currentTarget)}>
            <Icon icon={shareIcon()} /> {$_("studio.flight.share.moment")}
          </button>
        {/if}
      </section>
    </div>
  {/if}

  {#if status.asking}
    <!-- Asked before a flight starts again or goes on to the next storm, from a phone's strip: a thumb finds those too easily. -->
    <div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="flight-ask-title">
      <section class="glass glass-tray">
        <h2 id="flight-ask-title">{$_(`studio.flight.${status.asking}_ask.title`)}</h2>
        <p>{$_(`studio.flight.${status.asking}_ask.text`)}</p>
        <div class="choices">
          <button type="button" class="glass-pill" on:click={() => pilot.answer(false)}>{$_("studio.flight.leave_ask.stay")} <kbd>Esc</kbd></button>
          <button type="button" class="glass-pill end" on:click={() => pilot.answer(true)}>{$_(`studio.flight.${status.asking}_ask.go`)} <kbd>↵</kbd></button>
        </div>
      </section>
    </div>
  {/if}

  <!-- The credits are owed, not read while flying: a small way to them, as the map has. -->
  {#if !$touchControls}
    <div class="credits">
      <button type="button" class="licences-link" tabindex="-1" aria-haspopup="dialog" aria-expanded={licencesOpen}
        on:click={() => (licencesOpen ? closeLicences() : openLicences())}>{$_("studio.flight.licences")}</button>
    </div>
  {/if}
  {#if licencesOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="licences-scrim" on:click|self={closeLicences}>
      <div class="licences glass glass-tray" role="dialog" aria-modal="true" aria-labelledby="flight-licences-title">
        <header>
          <h2 id="flight-licences-title">{$_("studio.flight.licences_title")}</h2>
          <CloseDisc on:click={closeLicences} />
        </header>
        <div class="licences-body">
          <h3>{$_("studio.flight.licences_flight")}</h3>
          <ul>
            <li>{$_("studio.flight.model_credit")}</li>
            <li>{$_("studio.flight.licences_thunder")}</li>
            {#if attribution}<li>{$_("studio.flight.licences_map")} {attribution}</li>{/if}
          </ul>
          <h3>{$_("studio.flight.licences_data")}</h3>
          {#if dataLicences}
            <!-- The imprint's own list: this app's page, the same for every map. -->
            {@html dataLicences}
          {:else if dataLicencesFailed}
            <p>{$_("studio.flight.licences_failed")}</p>
          {:else}
            <p>{$_("studio.flight.licences_loading")}</p>
          {/if}
          <p class="all"><a href={IMPRINT} target="_blank" rel="noopener">{$_("studio.flight.licences_all")}</a></p>
        </div>
      </div>
    </div>
  {/if}
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
  /* Global within the readouts: the board's (board/BoardReadout.svelte) are drawn among them. */
  .readouts :global(dt) { color: #9aa3ad; font: 600 11px/1.4 var(--mc-font); text-transform: uppercase; letter-spacing: 0.05em; }
  .readouts :global(dd) { margin: 0; font: 700 14px/1.3 var(--mc-font); }
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
  /* Every top clear of the status bar, a phone's clock and all, where there is one; each where it fits (`neBeside`). */
  .corner-nw { top: calc(var(--mc-safe-top) + var(--nw-top, 16px)); left: 16px; }
  .corner-ne { top: calc(var(--mc-safe-top) + var(--ne-top, 16px)); right: var(--ne-right, 246px); }
  .corner-sw { bottom: 32px; left: 16px; }
  .corner-se { bottom: 32px; right: 16px; }

  /* The map of the flight, from outside: on the left over the readouts there, clear of the corners and the middle. */
  .flight-deck > :global(.flight-minimap) {
    position: absolute;
    left: 16px;
    bottom: 124px;
  }
  /* The horizon over it, on the same edge: the two read together, as a pilot's eye goes from one to the other. */
  .flight-deck { --flight-minimap-size: 196px; --flight-horizon-size: 132px; }
  .flight-deck > :global(.flight-horizon) {
    position: absolute;
    left: 16px;
    bottom: calc(124px + var(--flight-minimap-size) + 12px);
  }
  /* A low window has less room between its corners. */
  @container mc-frame (max-height: 560px) {
    .flight-deck { --flight-minimap-size: 144px; --flight-horizon-size: 104px; }
  }

  /* A storm's mark: a small diamond over it on a thin stem, and two lines of
     small print beside it. Quiet: it is a note on the view, not part of it. */
  .marks { position: absolute; inset: 0; overflow: hidden; }
  .rays { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  /* A radar a beam comes from: its name and how it saw the storm, beside where it stands, smaller than a storm's mark. */
  .radar {
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 6px;
    align-items: center;
    width: max-content;
    margin: -6px 0 0 -4px;
    opacity: 0;
    color: #e2faff;
    font: 600 10px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
    transition: opacity 0.4s;
    will-change: transform;
  }
  .radar i { grid-row: 1 / span 2; width: 8px; }
  .radar span { justify-self: start; padding: 0 4px; border-radius: 3px; background: rgba(6, 22, 30, 0.4); }
  .radar span:last-child { font-weight: 500; opacity: 0.8; }
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
  .flight-deck > .inspect > .modes { display: flex; align-items: center; gap: 10px; }
  /* Cut open, it has a second row: where the cut stands. */
  .flight-deck > .inspect.cutting {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    border-radius: 22px;
  }
  .cut-set {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px 2px;
    color: var(--mc-text);
    font-size: 14px;
    font-weight: 600;
  }
  .cut-set button {
    height: 34px;
    min-width: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-sheet-card);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .cut-set button:hover { background: rgba(255, 255, 255, 0.38); }
  .cut-set button.turn { padding: 0; }
  .cut-set .depth {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  /* A track of its own: a browser's is lost on the glass. The thumb in Studio's accent, which the cut's sheet is drawn in. */
  .cut-set input[type="range"] {
    flex: 1;
    min-width: 80px;
    height: 4px;
    margin: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.4);
    appearance: none;
    cursor: pointer;
  }
  .cut-set input[type="range"]::-webkit-slider-thumb {
    width: 18px;
    height: 18px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #ff9e1c;
    appearance: none;
  }
  .cut-set input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #ff9e1c;
  }
  .peel-set {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 6px 2px;
    color: var(--mc-text);
    font-size: 14px;
    font-weight: 600;
  }
  .peel-set input {
    flex: 1;
    min-width: 80px;
    height: 28px;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }
  .peel-set input::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--mc-hairline);
  }
  .peel-set input::-moz-range-track {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px var(--mc-hairline);
  }
  .peel-set input::-webkit-slider-thumb {
    width: 22px;
    height: 22px;
    margin-top: -7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    appearance: none;
  }
  .peel-set input::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  }
  .peel-set output,
  .cut-set output {
    min-width: 4.6em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .flight-deck > .inspect :global(.segmented button) {
    height: 40px;
    padding: 0 20px;
    font-size: 16px;
    font-weight: 600;
  }
  /* The cards and the warnings, and a recording's mark, stand clear of it. */
  .flight-deck.inspecting .popups { top: max(calc(var(--mc-safe-top) + var(--popups-top)), calc(var(--mc-safe-top) + 84px)); }
  .flight-deck.cutting .popups { top: max(calc(var(--mc-safe-top) + var(--popups-top)), calc(var(--mc-safe-top) + 128px)); }
  .flight-deck.inspecting .alerts { top: max(13%, calc(var(--mc-safe-top) + 84px)); }
  .flight-deck.inspecting .rec { top: calc(var(--mc-safe-top) + 78px); }
  .flight-deck.cutting .alerts { top: max(13%, calc(var(--mc-safe-top) + 128px)); }
  .flight-deck.cutting .rec { top: calc(var(--mc-safe-top) + 122px); }
  /* In a window too narrow for it between the speed and the altitude, it goes under them. */
  @container mc-frame (max-width: 1100px) {
    .flight-deck > .inspect { top: calc(var(--mc-safe-top) + 60px); }
    .flight-deck.inspecting .popups { top: max(calc(var(--mc-safe-top) + var(--popups-top)), calc(var(--mc-safe-top) + 130px)); }
    .flight-deck.cutting .popups { top: max(calc(var(--mc-safe-top) + var(--popups-top)), calc(var(--mc-safe-top) + 174px)); }
    .flight-deck.inspecting .alerts { top: max(13%, calc(var(--mc-safe-top) + 130px)); }
    .flight-deck.inspecting .rec { top: calc(var(--mc-safe-top) + 124px); }
    .flight-deck.cutting .alerts { top: max(13%, calc(var(--mc-safe-top) + 174px)); }
    .flight-deck.cutting .rec { top: calc(var(--mc-safe-top) + 168px); }
  }
  .mark.target i { border-color: #ff4fd8; }
  .mark.target span:first-of-type { color: #ffc2f1; }

  /*
   * The cards and the alerts: one column in the middle, under the top's
   * readouts (`popupsTop`), as wide as its widest card; the board's card
   * scrolls where it would reach the readouts at the foot. Under a finger,
   * not a column: each stands where the touch layout puts it.
   */
  .popups {
    position: absolute;
    top: calc(var(--mc-safe-top) + var(--popups-top, 56px));
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: calc(100% - 32px);
    margin: 0 auto;
  }
  .popups > :global(*) { flex: none; max-width: 100%; }
  .flight-deck:not(.touch) .popups > :global(.board-card) { max-height: calc(100cqh - var(--mc-safe-top) - var(--popups-top, 56px) - 120px); }
  .flight-deck.touch .popups { display: contents; }
  /* Its top is the touch layout's, as are those for a storm looked into above: in the column, it has none. */
  .alerts {
    top: max(13%, calc(var(--mc-safe-top) + 56px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .flight-deck.touch .alerts {
    position: absolute;
    left: 50%;
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
  .note.feat { border: 1px solid rgba(191, 140, 255, 0.7); color: #e2ccff; font-weight: 700; animation: feat 0.35s ease-out; }
  @keyframes feat { from { opacity: 0; transform: scale(0.85); } }
  .readouts .score.earning { color: #d9b8ff; }
  @keyframes blink { to { visibility: hidden; } }
  @media (prefers-reduced-motion: reduce) {
    .warning, .note.feat { animation: none; }
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
    top: calc(var(--mc-safe-top) + var(--muted-top, 50px));
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
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .licences-link {
    min-height: 24px;
    padding: 4px 8px;
    border: 0;
    background: none;
    color: rgba(255, 255, 255, 0.72);
    font: 500 10px/1.3 var(--mc-font);
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
    cursor: pointer;
    pointer-events: auto !important;
  }
  .licences-link:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 1px; }
  /* The licences: a card in the middle, over a scrim that closes it, its list scrolling inside it. */
  .licences-scrim {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: max(12px, var(--mc-safe-top)) max(16px, var(--mc-safe-right)) max(12px, var(--mc-safe-bottom)) max(16px, var(--mc-safe-left));
    background: rgba(0, 0, 0, 0.35);
    pointer-events: auto !important;
  }
  .licences {
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    max-height: 100%;
    min-height: 0;
    box-sizing: border-box;
    color: var(--mc-text);
    pointer-events: auto;
  }
  .licences header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 6px 18px; }
  .licences h2 { margin: 0; font: var(--mc-type-heading); }
  .licences-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    touch-action: pan-y;
    overscroll-behavior: contain;
    padding: 0 18px 16px;
    font: 12px/1.45 var(--mc-font);
    color: var(--mc-text-2);
    -webkit-user-select: text;
    user-select: text;
  }
  .licences-body :global(h3) { margin: 12px 0 4px; color: var(--mc-text); font: 600 13px/1.3 var(--mc-font); }
  .licences-body :global(ul) { margin: 0; padding-left: 18px; }
  .licences-body :global(li + li) { margin-top: 4px; }
  .licences-body :global(p) { margin: 6px 0 0; }
  .licences-body :global(a) { color: var(--mc-accent); }
  .licences-body .all { margin-top: 12px; }
  .inset-probe {
    position: absolute;
    visibility: hidden;
    padding-left: var(--mc-safe-left);
    padding-right: var(--mc-safe-right);
    pointer-events: none;
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
  /* Beside the top row's buttons, however many there are and however wide the way out is said. */
  .flight-deck.touch .corner-ne, .flight-deck.touch .corner-ne.beside-screen { top: var(--deck-top); right: calc(var(--deck-right) + var(--corner-room)); }
  .flight-deck.touch .corner-se { top: calc(var(--deck-top) + 46px); bottom: auto; right: var(--deck-right); }
  .flight-deck.touch .corner { top: calc(var(--deck-top) - 2px); right: var(--deck-right); }
  /*
   * On its side, on a phone whose notch or island cuts a strip off either
   * side of the view (`sides`): the round buttons in those strips, two a side
   * from the top, where they stay clear of the screen's rounded corner above
   * and of the island halfway down whichever side it is on; the way out alone
   * in the top row.
   */
  .flight-deck.touch.sides .corner { display: contents; }
  .flight-deck.touch.sides .corner > .leave { position: absolute; }
  .flight-deck.touch.sides .corner > .out { top: calc(var(--deck-top) - 2px); right: var(--deck-right); }
  .flight-deck.touch.sides .corner > :is(.help, .settings, .screen) { left: max(4px, calc((var(--mc-safe-left) - 36px) / 2)); }
  .flight-deck.touch.sides .corner > :is(.music, .share) { right: max(4px, calc((var(--mc-safe-right) - 36px) / 2)); }
  .flight-deck.touch.sides .corner > :is(.help, .music) { top: 22px; }
  .flight-deck.touch.sides .corner > :is(.settings, .share) { top: 62px; }
  .flight-deck.touch.sides .corner > .screen { top: 102px; }
  /* The credits' way in under the settings button, out of the row, which it would widen into the readouts beside it;
     on its side, under the settings in the strip on the left. */
  .flight-deck.touch .corner > .licences-link {
    position: absolute;
    top: calc(100% + 2px);
    /* The middle of the second button: the help button and the row's gap before it, and half of it (36px under a finger). */
    left: calc(36px + 8px + 18px);
    white-space: nowrap;
    transform: translateX(-50%);
  }
  .flight-deck.touch.sides .corner > .licences-link {
    position: absolute;
    top: 102px;
    transform: none;
    white-space: normal;
    left: max(0px, calc((var(--mc-safe-left) - 52px) / 2));
    width: 52px;
    padding: 4px 0;
    text-align: center;
  }
  .flight-deck.touch.sides.fullscreen-able .corner > .licences-link { top: 142px; }
  /* The top row's music button says whether the sound is off. */
  .flight-deck.touch .muted { display: none; }
  /* Over the strip, opened or not. */
  .flight-deck.touch .landing { bottom: calc(max(14px, var(--mc-safe-bottom)) + 112px); }
  /* The settings' card between the thumbs, clear of the stick and of the map and the horizon on the left, and scrolled
     where the screen is too low for all of it above the strip. */
  .flight-deck.touch .popups > :global(section.settings) {
    position: absolute;
    width: min(300px, calc(100% - 28px));
    top: calc(var(--deck-top) + 46px);
    right: auto;
    left: 50%;
    max-height: calc(100% - var(--deck-top) - 46px - 76px);
    overflow-y: auto;
    overscroll-behavior: contain;
    transform: translateX(-50%);
  }
  /* The map from outside: under the readouts on the left, over the lever. */
  .flight-deck.touch > :global(.flight-minimap) {
    top: calc(var(--deck-top) + 112px);
    bottom: auto;
    left: var(--deck-left);
  }
  .flight-deck.touch > :global(.flight-horizon) {
    top: calc(var(--deck-top) + 112px);
    bottom: auto;
    left: calc(var(--deck-left) + var(--flight-minimap-size) + 8px);
  }
  /* No keys to answer with. */
  .flight-deck.touch .ask kbd { display: none; }
  .flight-deck.touch .ask button { height: 44px; padding: 0 18px; }
  .flight-deck.touch .leave { height: 36px; }
  .flight-deck.touch .leave.full { width: 36px; }

  /* A phone: less of everything, and only what a flight is flown by. */
  @container mc-frame (max-height: 520px) or (max-width: 560px) {
    .flight-deck.touch .readouts > div { gap: 1px 8px; padding: 5px 9px; }
    .flight-deck.touch .readouts :global(dt) { font-size: 10px; }
    .flight-deck.touch .readouts :global(dd) { font-size: 13px; }
    /* With the board's score among them, it takes the place of the best flown here. */
    .flight-deck.touch .corner-nw.boarded .best { display: none; }
    /* The heading stays; the air outside and the frames a second are a desk's to read. */
    .flight-deck.touch .corner-sw :is(dt, dd):nth-of-type(n + 2) { display: none; }
    .flight-deck.touch .corner-sw { left: calc(var(--deck-left) + 160px); }
    .flight-deck.touch { --flight-minimap-size: 104px; --flight-horizon-size: 80px; }
    .flight-deck.touch > :global(:is(.flight-minimap, .flight-horizon)) { top: calc(var(--deck-top) + 46px); }
  }
  /* On its side there is no room left between the top row's readouts. */
  @container mc-frame (max-height: 520px) {
    /* The map and the horizon under the readouts on the left, not over them, and clear of the lever under both:
       the best score is the desk's to read, and the two a little smaller. */
    .flight-deck.touch .corner-nw .best { display: none; }
    /* And a board's row in place of another, so the map clears them: its score in place of the cockpit's,
       or none where the flight has no board (its note says so) and the cockpit's is the only one. */
    .flight-deck.touch .corner-nw.boarded:not(:has(.board-points.off)) .score { display: none; }
    .flight-deck.touch .corner-nw.boarded :global(:is(dt:has(+ dd .board-points.off), dd:has(.board-points.off))) {
      display: none;
    }
    .flight-deck.touch { --flight-minimap-size: 88px; --flight-horizon-size: 68px; }
    .flight-deck.touch > :global(:is(.flight-minimap, .flight-horizon)) { top: calc(var(--deck-top) + 48px); }
    .flight-deck.touch .warning { padding: 5px 12px; font-size: 16px; }
    .flight-deck.touch .landing { padding: 8px 12px 9px; }
    .flight-deck.touch .landing p { gap: 10px; font-size: 12px; }
    /* Under the top row, which has no room left between its readouts. */
    .flight-deck.touch > .inspect { top: calc(var(--deck-top) + 44px); gap: 6px; padding: 4px 6px; }
    .flight-deck.touch > .inspect :global(.segmented button) { height: 34px; padding: 0 14px; font-size: 14px; }
    .flight-deck.touch.inspecting .alerts { top: calc(var(--deck-top) + 96px); }
    .flight-deck.touch.cutting .alerts { top: calc(var(--deck-top) + 140px); }
  }
  /* Held upright, the top row is two: the heading goes under the speed. */
  @container mc-frame (max-width: 560px) {
    .flight-deck.touch .corner-sw { top: calc(var(--deck-top) + 46px); left: var(--deck-left); }
    .flight-deck.touch .corner-ne, .flight-deck.touch .corner-ne.beside-screen { top: calc(var(--deck-top) + 46px); right: var(--deck-right); }
    .flight-deck.touch .corner-se { top: calc(var(--deck-top) + 92px); }
    .flight-deck.touch > :global(:is(.flight-minimap, .flight-horizon)) { top: calc(var(--deck-top) + 92px); }
    .flight-deck.touch .alerts { top: calc(var(--deck-top) + 150px); }
    .flight-deck.touch > .inspect { top: calc(var(--deck-top) + 100px); }
  }
</style>
