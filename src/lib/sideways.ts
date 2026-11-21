/**
 * The flight on its side, inside the apps.
 *
 * The apps' web view stays upright however the phone is turned, and the
 * flight is a landscape picture: a cockpit, a thumb either side of it. So
 * while the flight's page, its plan, its loading or the flight itself is up
 * in one of the apps (`holdSideways`), the page is laid out at the size of
 * the phone turned on its side and drawn a quarter turn round onto the
 * upright screen. <body> is the frame: as wide as the screen is tall, as
 * tall as it is wide, and turned by a CSS transform (global.css,
 * `html.mc-sideways`). Everything on the page turns with it, what is fixed
 * and what opens over it too, since a transformed body is what those are
 * placed in. The apps' own buttons, which the page cannot turn, are put
 * away for as long (`hideNativeControls`).
 *
 * Which quarter: the top of the phone to the left, the usual way round for
 * a game, with the notch on the left; and the other way once the phone has
 * been held that way round for a moment. Android says how it is held without
 * asking; iOS only once the reader has let the flight read it (the touch
 * controls' tilt), and until then it stays the usual way round.
 *
 * What the browser does not turn is where its events say a finger is:
 * clientX and clientY, movementX and movementY and an element's
 * getBoundingClientRect() stay the upright screen's. Whatever reads a
 * position off the page for itself takes it through here (`framePoint`,
 * `frameDelta`, `frameBox`, `pointWithin`), and an OpenLayers map through
 * `followSideways`. MapLibre reads positions in a way that cannot be turned
 * from outside, so the 3D map does not take the pointer while the page is
 * on its side (global.css): during a flight the deck over it does. Hit
 * testing, taps and scrolling are the browser's, and turn already; a finger
 * dragged along a slider is not, and is read here too.
 *
 * Media queries still see the upright screen, so the flight's components
 * ask their frame instead (`@container mc-frame`: Studio's overlay, and the
 * flight page's body); and the safe area's insets are handed round with
 * the picture (`--mc-safe-*`).
 *
 * To try it without the apps: open the page with `?sideways` in its address
 * (for that load), or set localStorage `mc-sideways` to `1` (until removed),
 * in a window taller than it is wide: a phone's browser, or a desktop
 * browser's device mode.
 */
import { writable } from "svelte/store";
import type OlMap from "ol/Map";
import { DeviceDetect as dd } from "./DeviceDetect";
import { hideNativeControls } from "./nativeBridge";

/**
 * How far the picture is turned on the screen, degrees clockwise: 90 with
 * its top at the screen's right edge, which is the phone held with its top
 * to the left; -90 the other way round; 0 upright.
 */
export type Turn = 0 | 90 | -90;

/** The upright screen, CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A point on the upright screen (an event's clientX and clientY) as it lies
 * in the turned picture, CSS pixels from the picture's top left. The
 * picture is `viewport.height` wide and `viewport.width` tall.
 */
export function toFrame(x: number, y: number, turn: Turn, viewport: Viewport): [number, number] {
  if (turn === 90) return [y, viewport.width - x];
  if (turn === -90) return [viewport.height - y, x];
  return [x, y];
}

/** A movement on the upright screen as it goes across the turned picture. */
export function deltaToFrame(dx: number, dy: number, turn: Turn): [number, number] {
  if (turn === 90) return [dy, -dx];
  if (turn === -90) return [-dy, dx];
  return [dx, dy];
}

/**
 * An element's box as the upright screen measures it (getBoundingClientRect)
 * as it lies in the turned picture. A quarter turn takes a box to a box, so
 * this is the element's own box in the picture.
 */
export function boxToFrame(rect: Box, turn: Turn, viewport: Viewport): Box {
  const [ax, ay] = toFrame(rect.left, rect.top, turn, viewport);
  const [bx, by] = toFrame(rect.left + rect.width, rect.top + rect.height, turn, viewport);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** How much of gravity has to lie along the phone's long edge before it counts as held on that side. */
const SIDE_DOWN = 0.5;

/**
 * Which way round to draw the picture for how the phone is held: from what
 * it says of itself (`DeviceOrientationEvent`: `beta` about its short axis,
 * `gamma` about its long one, degrees). Its left side down, the top of the
 * phone is to the left: 90. Its right side down: -90. Lying flat or
 * standing upright says neither: null.
 */
export function turnHeld(beta: number, gamma: number): Turn | null {
  const [b, g] = [beta, gamma].map((degrees) => (degrees * Math.PI) / 180);
  // Down, in the device's own frame: x to its right, y to its top (as lib/studio/flight/touch.ts reads it).
  const side = Math.sin(g) * Math.cos(b);
  const along = -Math.sin(b);
  if (Math.abs(side) < SIDE_DOWN || Math.abs(side) <= Math.abs(along)) return null;
  return side < 0 ? 90 : -90;
}

/* ---- the page ---- */

const FORCE_PARAM = "sideways";
const FORCE_KEY = "mc-sideways";

/** Forced on to try without the apps (see the header): read once, before anything rewrites the address. */
function readForced(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const asked = new URLSearchParams(window.location.search).get(FORCE_PARAM);
    if (asked !== null && asked !== "0" && asked !== "off") return true;
  } catch {
    // An address that cannot be read asks for nothing.
  }
  try {
    return window.localStorage.getItem(FORCE_KEY) === "1";
  } catch {
    return false;
  }
}
const forced = readForced();

/** How long the phone has to be held the other way round before the picture turns with it, ms. */
const TURN_AFTER_MS = 600;
/** How long the picture takes to turn over; global.css has the same. */
const TURNING_MS = 450;

const CLASS = "mc-sideways";
const CLASS_CW = "mc-sideways-cw";
const CLASS_CCW = "mc-sideways-ccw";
const CLASS_TURNING = "mc-sideways-turning";

let holds = 0;
let turn: Turn = 0;
/** The way round the picture was last drawn: kept for the next time. */
let preferred: Turn = 90;
let viewport: Viewport = { width: 0, height: 0 };
let releaseControls: (() => void) | null = null;
/** The other way round, and since when the phone has said so. */
let pending: { turn: Turn; since: number } | null = null;
let turningTimer: ReturnType<typeof setTimeout> | null = null;

const turnStore = writable<Turn>(0);
/** How the picture is turned now; 0 while the page is upright. */
export const sidewaysTurn = { subscribe: turnStore.subscribe };

/** The same, read at once: for a handler of a pointer event. */
export const currentTurn = (): Turn => turn;

const measure = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

function draw(): void {
  const root = document.documentElement;
  root.classList.toggle(CLASS, turn !== 0);
  root.classList.toggle(CLASS_CW, turn === 90);
  root.classList.toggle(CLASS_CCW, turn === -90);
  if (turn === 0) {
    root.style.removeProperty("--mc-sideways-w");
    root.style.removeProperty("--mc-sideways-h");
  } else {
    root.style.setProperty("--mc-sideways-w", `${viewport.width}px`);
    root.style.setProperty("--mc-sideways-h", `${viewport.height}px`);
  }
  turnStore.set(turn);
}

function held(event: DeviceOrientationEvent): void {
  if (turn === 0 || event.beta === null || event.gamma === null) return;
  const asked = turnHeld(event.beta, event.gamma);
  if (asked === null || asked === turn) {
    pending = null;
    return;
  }
  const now = performance.now();
  if (pending?.turn !== asked) {
    pending = { turn: asked, since: now };
    return;
  }
  if (now - pending.since < TURN_AFTER_MS) return;
  pending = null;
  turnOver(asked);
}

function turnOver(to: Turn): void {
  const root = document.documentElement;
  root.classList.add(CLASS_TURNING);
  if (turningTimer !== null) clearTimeout(turningTimer);
  turningTimer = setTimeout(() => {
    turningTimer = null;
    root.classList.remove(CLASS_TURNING);
  }, TURNING_MS);
  turn = to;
  preferred = to;
  draw();
}

/* A slider under a finger. The browser turns a tap on one, but reads a
   finger dragged along it against the upright screen, where it goes across
   the slider rather than along it: so on its side a finger slides a slider
   here, from where it is along the slider as drawn. A mouse is the
   browser's still. */
let sliding: { input: HTMLInputElement; id: number } | null = null;

function slideTo(event: PointerEvent, input: HTMLInputElement): void {
  const box = frameBox(input);
  const share = Math.min(Math.max((framePoint(event)[0] - box.left) / Math.max(box.width, 1), 0), 1);
  const [min, max] = [Number(input.min || 0), Number(input.max || 100)];
  const before = input.value;
  // The input rounds it to its step.
  input.value = String(min + share * (max - min));
  if (input.value !== before) input.dispatchEvent(new Event("input", { bubbles: true }));
}
function slideDown(event: PointerEvent): void {
  const input = event.target;
  if (event.pointerType === "mouse" || !(input instanceof HTMLInputElement) || input.type !== "range" || input.disabled) return;
  sliding = { input, id: event.pointerId };
  try {
    input.setPointerCapture(event.pointerId);
  } catch {
    // Followed for as long as its moves still arrive.
  }
  slideTo(event, input);
}
function slideMove(event: PointerEvent): void {
  if (sliding?.id === event.pointerId) slideTo(event, sliding.input);
}
function slideUp(event: PointerEvent): void {
  if (sliding?.id !== event.pointerId) return;
  const { input } = sliding;
  sliding = null;
  if (event.type === "pointerup") input.dispatchEvent(new Event("change", { bubbles: true }));
}
const SLIDING: Array<[string, (event: PointerEvent) => void]> = [
  ["pointerdown", slideDown], ["pointermove", slideMove], ["pointerup", slideUp], ["pointercancel", slideUp],
];

/** Whether the page should be on its side now, and the apps' buttons away: set it so. */
function settle(): void {
  const app = dd.isApp();
  const wanted = holds > 0 && (app || forced);
  // The apps' buttons go for the whole of it, whichever way the screen is: the page cannot move them out of the flight's way.
  if (holds > 0 && app && !releaseControls) releaseControls = hideNativeControls();
  if (holds === 0 && releaseControls) {
    releaseControls();
    releaseControls = null;
  }
  viewport = measure();
  // A web view that is already wider than tall (a tablet turned) has the picture the right way up.
  const sideways = wanted && viewport.height > viewport.width;
  if (sideways && turn === 0) {
    turn = preferred;
    window.addEventListener("deviceorientation", held);
    for (const [type, listener] of SLIDING) document.addEventListener(type, listener as EventListener, true);
  } else if (!sideways && turn !== 0) {
    turn = 0;
    pending = null;
    sliding = null;
    window.removeEventListener("deviceorientation", held);
    for (const [type, listener] of SLIDING) document.removeEventListener(type, listener as EventListener, true);
  }
  draw();
}

/**
 * Puts the page on its side, inside the apps (or where forced), until the
 * returned function is called: for the flight's page, its plan, its loading
 * and the flight. Held by several at once, it stays until the last lets go;
 * releasing twice is harmless.
 */
export function holdSideways(): () => void {
  if (typeof window === "undefined") return () => undefined;
  holds += 1;
  if (holds === 1) window.addEventListener("resize", settle);
  settle();
  let holding = true;
  return () => {
    if (!holding) return;
    holding = false;
    holds -= 1;
    if (holds === 0) window.removeEventListener("resize", settle);
    settle();
  };
}

/** A pointer's place (clientX, clientY) in the picture as it is drawn now. */
export function framePoint(event: { clientX: number; clientY: number }): [number, number] {
  return toFrame(event.clientX, event.clientY, turn, viewport);
}

/** A movement on the screen (movementX and movementY, or two clientX and clientY apart) across the picture as it is drawn now. */
export function frameDelta(dx: number, dy: number): [number, number] {
  return deltaToFrame(dx, dy, turn);
}

/** An element's box in the picture as it is drawn now: getBoundingClientRect(), turned. */
export function frameBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return turn === 0 ? rect : boxToFrame(rect, turn, viewport);
}

/** Where a pointer is on an element, CSS pixels from its top left, however the picture is turned. */
export function pointWithin(event: { clientX: number; clientY: number }, element: Element): [number, number] {
  const [x, y] = framePoint(event);
  const box = frameBox(element);
  return [x - box.left, y - box.top];
}

/**
 * Has an OpenLayers map read its events in the picture as it is drawn: a
 * click, a drag and a pinch on it all go through its getEventPixel, which
 * otherwise measures against the upright screen.
 */
export function followSideways(map: OlMap): void {
  const upright = map.getEventPixel.bind(map);
  map.getEventPixel = (event) => {
    if (turn === 0) return upright(event);
    const at = "changedTouches" in event ? (event as TouchEvent).changedTouches[0] : (event as { clientX: number; clientY: number });
    const [x, y] = pointWithin(at, map.getViewport());
    const box = frameBox(map.getViewport());
    const size = map.getSize();
    const scaleX = size?.[0] ? box.width / size[0] : 1;
    const scaleY = size?.[1] ? box.height / size[1] : 1;
    return [x / scaleX, y / scaleY];
  };
}
