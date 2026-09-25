/**
 * The slice swinging slowly through an opened storm on its own.
 *
 * On the 3D map a storm opens cut square to the camera, and a still cut shows
 * one plane through it. Swinging the plane shows the storm's inside as a
 * sequence of slices -- where the core leans, where it is widest -- without
 * the reader having to find the dial first.
 *
 * A swing to either side of where it opened rather than a full turn. The
 * camera stays where it is, and a plane turned more than a quarter away from
 * it shows the kept half from outside: for half of every turn the storm would
 * be an uncut cloud with the cut face hidden behind it. Seventy degrees each
 * way keeps the face in view and still sweeps most of the way round.
 *
 * It stops, keeping the angle it had reached, the moment the reader takes
 * hold of the slice themselves: a sweep that fought the dial, or jumped back
 * to where it would have been, would make the dial feel broken. It also stops
 * on its own after a couple of swings: every step of it is a repaint of the
 * whole 3D map, and a storm left open on a desk had the map redrawing for as
 * long as the popup stayed up.
 */
import { get } from "svelte/store";
import { cutRotationDeg, cutSweepDeg } from "../stores";
import { normaliseCut } from "./cutAngle";

/** Degrees either side of the opening angle. */
const AMPLITUDE_DEG = 70;
/** Seconds for one swing there and back. */
const PERIOD_SECONDS = 24;
/** How many swings before the slice comes to rest on its own. */
export const SWINGS = 2;
/**
 * Steps a second. The swing is slow and every step repaints the map, so the
 * display's own rate would be several times the frames anyone can see.
 */
export const SWEEP_FPS = 20;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Start swinging from the current angle, from the start of a swing. Honours reduced motion. */
export function startSweep(): void {
  stopSweep(false);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const start = performance.now();
  const step = () => {
    const seconds = (performance.now() - start) / 1000;
    if (seconds >= SWINGS * PERIOD_SECONDS) {
      // Back where it started after whole swings, so nothing is kept.
      stopSweep(true);
      return;
    }
    const phase = (seconds / PERIOD_SECONDS) * Math.PI * 2;
    cutSweepDeg.set(AMPLITUDE_DEG * Math.sin(phase));
    timer = setTimeout(step, 1000 / SWEEP_FPS);
  };
  timer = setTimeout(step, 1000 / SWEEP_FPS);
}

/**
 * Stop swinging. `keep` leaves the slice where the swing had taken it, by
 * folding the swing into the reader's own angle; otherwise it falls back.
 */
export function stopSweep(keep: boolean): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const swung = get(cutSweepDeg);
  if (swung === 0) return;
  if (keep) cutRotationDeg.set(normaliseCut(Math.round(get(cutRotationDeg) + swung)));
  cutSweepDeg.set(0);
}
