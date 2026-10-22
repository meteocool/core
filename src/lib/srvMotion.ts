/**
 * The motion storm-relative velocity takes out, and whose it is: the
 * selected storm's, or one the reader set by hand on the tray's dial.
 *
 * By hand is for when no storm is selected, or none says how it moves, or
 * the reader knows better: a chaser who has the motion from a sounding, or
 * from watching the storm, wants that and not the tracker's. The selected
 * storm's is taken where there is one, unless the reader asked for their own.
 *
 * Kept by hand in km/h and whole degrees, the way the storm panel says a
 * storm's speed and heading; SRV is then m/s, as the radar measures.
 *
 * Pure: plain values in and out, so the unit tests can hold it.
 */
import type { Motion } from "./sweepGeometry";

/** A motion set by hand: the heading it moves toward, clockwise from north, and how fast. */
export interface ManualMotion {
  headingDeg: number;
  speedKmh: number;
}

/** Whose motion SRV takes out. */
export type MotionSource = "storm" | "manual";

/** The motion SRV takes out, and whose it is. */
export interface SrvMotion {
  source: MotionSource;
  motion: Motion;
}

/** What the dial snaps to, and an arrow key turns it by. */
export const HEADING_STEP_DEG = 5;
/** What the stepper adds or takes away. */
export const SPEED_STEP_KMH = 5;
/** As fast as the stepper goes: faster than any storm in Europe moves. */
export const MAX_SPEED_KMH = 150;

/**
 * Before the reader sets one: going north-east, the way most storms here go,
 * so the arrow starts somewhere useful; but standing still, so nothing is
 * taken out until they say how fast.
 */
export const DEFAULT_MANUAL_MOTION: ManualMotion = { headingDeg: 45, speedKmh: 0 };

/** A heading in [0, 360). */
export function normalHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** A heading on the dial's grid of `HEADING_STEP_DEG`, 360 being 0. */
export function snapHeading(deg: number): number {
  return normalHeading(Math.round(deg / HEADING_STEP_DEG) * HEADING_STEP_DEG);
}

/** A speed the stepper can hold: whole km/h, from standing still to `MAX_SPEED_KMH`. */
export function clampSpeed(kmh: number): number {
  if (!Number.isFinite(kmh)) return 0;
  return Math.min(Math.max(Math.round(kmh), 0), MAX_SPEED_KMH);
}

/**
 * The heading a finger at (`dx`, `dy`) from the dial's centre points along,
 * in screen pixels (y down), snapped; null on the centre itself, which
 * points nowhere.
 */
export function headingFromPoint(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  return snapHeading((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** The heading `steps` clicks round from `deg`, clockwise for positive. */
export function turnHeading(deg: number, steps: number): number {
  return snapHeading(deg + steps * HEADING_STEP_DEG);
}

/**
 * The stepper's next speed up (+1) or down (-1): the next multiple of
 * `SPEED_STEP_KMH` that way, so a typed 43 goes to 45 or 40 and then on in
 * fives.
 */
export function stepSpeed(kmh: number, direction: 1 | -1): number {
  const on = clampSpeed(kmh);
  const next = direction > 0
    ? Math.floor(on / SPEED_STEP_KMH) * SPEED_STEP_KMH + SPEED_STEP_KMH
    : Math.ceil(on / SPEED_STEP_KMH) * SPEED_STEP_KMH - SPEED_STEP_KMH;
  return clampSpeed(next);
}

/** The manual motion as the setting `srvMotion` keeps it: "heading,km/h". */
export function formatManualMotion(motion: ManualMotion): string {
  return `${snapHeading(motion.headingDeg)},${clampSpeed(motion.speedKmh)}`;
}

/** The setting `srvMotion` read back; anything it cannot read is the default. */
export function parseManualMotion(value: unknown): ManualMotion {
  if (typeof value !== "string") return DEFAULT_MANUAL_MOTION;
  const parts = value.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return DEFAULT_MANUAL_MOTION;
  const [heading, speed] = parts.map(Number);
  if (!Number.isFinite(heading) || !Number.isFinite(speed)) return DEFAULT_MANUAL_MOTION;
  return { headingDeg: snapHeading(heading), speedKmh: clampSpeed(speed) };
}

/** Whether two manual motions are the same, as the setting would keep them. */
export function sameManualMotion(a: ManualMotion, b: ManualMotion): boolean {
  return formatManualMotion(a) === formatManualMotion(b);
}

/** A manual motion as SRV takes it: m/s. */
export function motionOfManual(manual: ManualMotion): Motion {
  return { speedMs: clampSpeed(manual.speedKmh) / 3.6, headingDeg: snapHeading(manual.headingDeg) };
}

/**
 * What SRV takes out: the selected storm's motion where it says one and the
 * reader has not asked for their own, else theirs.
 */
export function resolveMotion(storm: Motion | null, manual: ManualMotion, prefersManual: boolean): SrvMotion {
  if (storm && !prefersManual) return { source: "storm", motion: storm };
  return { source: "manual", motion: motionOfManual(manual) };
}

/**
 * The manual motion an edit starts from: the one SRV is taking out. A
 * reader who turns the dial while it shows the selected storm's motion is
 * correcting that storm's, so the storm's is where the correction starts.
 */
export function editBase(srv: SrvMotion, manual: ManualMotion): ManualMotion {
  if (srv.source === "manual") return manual;
  return { headingDeg: snapHeading(srv.motion.headingDeg), speedKmh: clampSpeed(srv.motion.speedMs * 3.6) };
}

/** The sixteen points the storm panel words a heading in, clockwise from north. */
export const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

/** The point of the compass a heading is nearest, as `storm.compass.*` names it. */
export function compassPoint(deg: number): (typeof COMPASS_POINTS)[number] {
  return COMPASS_POINTS[Math.round(normalHeading(deg) / 22.5) % 16];
}
