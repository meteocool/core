import { onMapMotion } from "./mapMotion";
import type Settings from "./Settings";

/**
 * Whether this device struggles to move the map, decided once by timing it
 * moving the map.
 *
 * The glass over the map can go solid while the map moves
 * (`solidGlassWhileMoving`), which takes most of the GPU's work off every
 * frame of a pan, but the switch from frosted to solid and back is visible
 * every time, so it is off unless a device needs it. Which devices those are
 * is not something the browser says: core counts and memory are capped,
 * rounded or absent depending on the engine, and a fast phone and a slow one
 * report the same. So the first few seconds of moving the map are timed
 * instead, and a phone that drops a quarter of its frames gets the solid
 * glass, once. The verdict is kept, so a reader who turns it back off is not
 * overruled on the next visit.
 *
 * Only touch devices are measured. A desktop, however busy it is the moment
 * it is timed, never gets it.
 */

/** Where the verdict is kept. Not a setting: the reader never sees it. */
const VERDICT_KEY = "slowDeviceVerdict";

/** How many frames of moving the map make a verdict. */
export const FRAMES_NEEDED = 180;

/** A frame interval this long or longer means frames were dropped; see `droppedShare`. */
const FRAME_MS = 1000 / 60;

/** The share of frames a device may drop while moving the map and still count as fine. */
export const SLOW_SHARE = 0.25;

/**
 * Moves started this soon after the page are not timed: the first seconds
 * are the map's tiles and labels loading, which stutters on any phone.
 */
const WARMUP_MS = 10_000;

/**
 * The share of frames dropped, out of every frame the display would have shown.
 *
 * A 40 ms interval at 60 Hz is two frames missed, not one long one, so each
 * interval counts the frames it swallowed. A 120 Hz display's 8 ms intervals
 * count as on time.
 */
export function droppedShare(intervals: number[]): number {
  let dropped = 0;
  for (const ms of intervals) dropped += Math.max(0, Math.round(ms / FRAME_MS) - 1);
  return dropped / (intervals.length + dropped || 1);
}

/** Slow, fine, or not enough frames yet to say. */
export function verdictFor(intervals: number[]): "slow" | "fine" | null {
  if (intervals.length < FRAMES_NEEDED) return null;
  return droppedShare(intervals) > SLOW_SHARE ? "slow" : "fine";
}

function storedVerdict(): string | null {
  try {
    return localStorage.getItem(VERDICT_KEY);
  } catch {
    // No storage, no verdict to keep: not measuring beats measuring every visit.
    return "unavailable";
  }
}

/**
 * Time the map's first moves on a touch device, and turn the solid glass on
 * if it struggles. Does nothing once a verdict is on record, or on a desktop.
 */
export function watchForSlowDevice(settings: Settings): void {
  if (storedVerdict() !== null) return;
  const touch = window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(hover: hover)").matches;
  if (!touch) return;
  // Already on, by the reader: nothing for a verdict to decide.
  if (settings.getBoolean("solidGlassWhileMoving")) {
    keep("fine");
    return;
  }

  const started = performance.now();
  const intervals: number[] = [];
  let frame: number | undefined;
  let last = 0;

  const tick = (now: number) => {
    if (last) intervals.push(now - last);
    last = now;
    frame = requestAnimationFrame(tick);
  };

  const stopListening = onMapMotion((moving) => {
    if (moving) {
      if (performance.now() - started < WARMUP_MS || frame !== undefined) return;
      last = 0;
      frame = requestAnimationFrame(tick);
      return;
    }
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    const verdict = verdictFor(intervals);
    if (!verdict) return;
    stopListening();
    keep(verdict);
    if (verdict === "slow") settings.set("solidGlassWhileMoving", true);
  });

  function keep(verdict: "slow" | "fine") {
    try {
      localStorage.setItem(VERDICT_KEY, verdict);
    } catch {
      // See storedVerdict.
    }
  }
}
