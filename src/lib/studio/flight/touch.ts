/**
 * The flight under two thumbs: what a phone or a tablet flies with, where
 * there are no keys to hold (components/studio/flight/TouchControls.svelte).
 *
 * This is the arithmetic of it, apart from the page: a stick that reads a
 * thumb's travel from where it came down, a throttle lever that stays where
 * it is put, and the phone itself held as a yoke. Each gives what the keys
 * give (`ControlInput`, controls.ts), with the same signs: pulled back is
 * nose up.
 */
import { writable } from "svelte/store";

/**
 * Whether the touch controls are on the flight deck: from the start on a
 * device whose pointer is a finger, and from the first touch on one that has
 * a touch screen beside its mouse.
 */
export const touchControls = writable<boolean>(false);

/** Whether this device's own pointer is a finger. */
export function touchFirst(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return navigator.maxTouchPoints > 0 && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

/** Whether it has a touch screen at all. */
export const touchCapable = (): boolean => typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A thumb resting on the stick is not flying it: this share of its travel round the middle is nothing. */
export const STICK_DEAD = 0.1;
/**
 * How the rest of the travel is read: gently at first, so a small movement
 * is a small one, and all of it by the rim.
 */
const STICK_CURVE = 1.5;

/** One axis of a thumb's travel, -1 to 1 of its reach, as the aircraft is asked: nothing near the middle, gently after. */
export function axisInput(travel: number, reach: number): number {
  const share = clamp(travel / Math.max(reach, 1), -1, 1);
  const size = Math.abs(share);
  if (size <= STICK_DEAD) return 0;
  return Math.sign(share) * ((size - STICK_DEAD) / (1 - STICK_DEAD)) ** STICK_CURVE;
}

/**
 * The stick: a thumb `dx` right and `dy` down the screen from where it came
 * down, in pixels, with `reach` pixels of travel. Right rolls right; down
 * the screen is the stick pulled back, nose up. The knob stays inside the
 * rim (`x`, `y`), and what is asked is read off where it is.
 */
export function stickInput(dx: number, dy: number, reach: number): { roll: number; pitch: number; x: number; y: number } {
  const far = Math.hypot(dx, dy);
  const scale = far > reach && far > 0 ? reach / far : 1;
  const [x, y] = [dx * scale, dy * scale];
  const size = Math.min(far, reach) / Math.max(reach, 1);
  if (size <= STICK_DEAD) return { roll: 0, pitch: 0, x, y };
  // By how far the thumb is from the middle, whichever way: a diagonal is not slower than an axis.
  const asked = ((size - STICK_DEAD) / (1 - STICK_DEAD)) ** STICK_CURVE / size;
  return { roll: (x / reach) * asked, pitch: (y / reach) * asked, x, y };
}

/**
 * The throttle lever's track, as shares of its length from the bottom: below
 * idle, the reversers, held there; a notch at idle that the lever falls
 * into; and the rest of it thrust, idle to all of it.
 */
export const LEVER_REVERSE = 0.15;
export const LEVER_IDLE = 0.27;
/** Where the lever rests at idle: in the middle of its notch. */
export const LEVER_IDLE_REST = (LEVER_REVERSE + LEVER_IDLE) / 2;

/** What a thumb at a share of the track asks: where the throttle should be, 0 to 1, and whether the reversers are pulled. */
export function leverAt(share: number): { lever: number; reverse: boolean } {
  if (share < LEVER_REVERSE) return { lever: 0, reverse: true };
  return { lever: clamp((share - LEVER_IDLE) / (1 - LEVER_IDLE), 0, 1), reverse: false };
}

/** Where on the track a throttle stands, a share from the bottom. */
export function leverShare(throttle: number): number {
  return throttle <= 0 ? LEVER_IDLE_REST : LEVER_IDLE + clamp(throttle, 0, 1) * (1 - LEVER_IDLE);
}

/** The lever is where it was put once the throttle is this near it. */
const LEVER_ARRIVED = 0.004;
/** How hard the throttle is moved for how far it has to go: all the way from this share away and further. */
const LEVER_FULL_FROM = 0.08;
/** Onto either end of its travel it is pushed at least this hard, so it gets there and stops on it. */
const LEVER_ONTO_STOP = 0.25;

/**
 * How fast to move the throttle, -1 to 1, for it to come to where the lever
 * was put: the aircraft takes a rate (`ControlInput.throttle`), as W and S
 * give one, and this is the rate that ends at the lever and no further.
 * Nothing once it is there.
 */
export function leverRate(lever: number, throttle: number): number {
  const away = lever - throttle;
  if (away === 0) return 0;
  const rate = clamp(away / LEVER_FULL_FROM, -1, 1);
  // Idle and full thrust are stops, reached exactly: the reversers and the spoilers ask whether it is at idle.
  if (lever <= 0 || lever >= 1) return Math.sign(away) * Math.max(Math.abs(rate), LEVER_ONTO_STOP);
  return Math.abs(away) < LEVER_ARRIVED ? 0 : rate;
}

/** How a phone is held: tipped back from upright, and its right side lower than its left, degrees. */
export interface Tilt {
  back: number;
  side: number;
}

/**
 * How the screen is held, from what the device says of itself
 * (`DeviceOrientationEvent`: `beta` about its short axis, `gamma` about its
 * long one, degrees) and how far the page is turned on it (`angle`, the
 * screen's orientation: 90 with the top of the phone to the left).
 *
 * By way of which way is down as the screen sees it, not the angles
 * themselves: turned on its side the two angles swap what they mean, and one
 * of them flips where the screen stands upright.
 */
export function tiltOf(beta: number, gamma: number, angle = 0): Tilt {
  const [b, g, a] = [beta, gamma, angle].map((degrees) => (degrees * Math.PI) / 180);
  // Down, in the device's own frame: x to its right, y to its top, z out of the screen.
  const down = [Math.sin(g) * Math.cos(b), -Math.sin(b), -Math.cos(g) * Math.cos(b)];
  // And as the page lies on it: x to the picture's right, y to its top.
  const right = down[0] * Math.cos(a) - down[1] * Math.sin(a);
  const up = down[0] * Math.sin(a) + down[1] * Math.cos(a);
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    back: degrees(Math.atan2(-down[2], -up)),
    side: degrees(Math.asin(clamp(right, -1, 1))),
  };
}

/** How far a phone is tipped for all of the stick, degrees; and how little is a hand not quite still. */
const TILT_FULL = { pitch: 22, roll: 28 };
const TILT_DEAD = 3;

/**
 * What a phone held as a yoke asks, against how it was held when the reader
 * began (`neutral`): its right side down rolls right, its top brought
 * towards the reader is the yoke pulled back, nose up.
 */
export function tiltInput(now: Tilt, neutral: Tilt): { roll: number; pitch: number } {
  const axis = (degrees: number, full: number) => {
    // The short way round: a phone tipped a little past flat reads a turn less, not a turn more.
    const turned = ((degrees + 540) % 360) - 180;
    const size = Math.abs(turned);
    return size <= TILT_DEAD ? 0 : Math.sign(turned) * Math.min(1, (size - TILT_DEAD) / (full - TILT_DEAD));
  };
  return {
    roll: axis(now.side - neutral.side, TILT_FULL.roll),
    pitch: axis(neutral.back - now.back, TILT_FULL.pitch),
  };
}

/**
 * Two fingers on the view: how many of the wheel's steps the eye moves for
 * the distance between them going from `before` to `now`, pixels. Spread
 * apart is nearer, as a picture is pulled larger; the wheel's step is a
 * tenth or so, and so is one here.
 */
export function pinchSteps(before: number, now: number): number {
  if (before <= 0 || now <= 0) return 0;
  return Math.log(before / now) / Math.log(1.1);
}
