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
 * to where it would have been, would make the dial feel broken.
 */
import { get } from "svelte/store";
import { cutRotationDeg, cutSweepDeg } from "../stores";
import { normaliseCut } from "./cutAngle";

/** Degrees either side of the opening angle. */
const AMPLITUDE_DEG = 70;
/** Seconds for one swing there and back. */
const PERIOD_SECONDS = 24;

let frame = 0;

/** Start swinging from the current angle, from the start of a swing. Honours reduced motion. */
export function startSweep(): void {
  stopSweep(false);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const start = performance.now();
  const step = (now: number) => {
    const phase = ((now - start) / 1000 / PERIOD_SECONDS) * Math.PI * 2;
    cutSweepDeg.set(AMPLITUDE_DEG * Math.sin(phase));
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/**
 * Stop swinging. `keep` leaves the slice where the swing had taken it, by
 * folding the swing into the reader's own angle; otherwise it falls back.
 */
export function stopSweep(keep: boolean): void {
  cancelAnimationFrame(frame);
  frame = 0;
  const swung = get(cutSweepDeg);
  if (swung === 0) return;
  if (keep) cutRotationDeg.set(normaliseCut(Math.round(get(cutRotationDeg) + swung)));
  cutSweepDeg.set(0);
}
