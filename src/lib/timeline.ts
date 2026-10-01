/**
 * The playback timeline, as numbers: which five-minute steps it holds, where
 * its labels go, and how a flicked needle slows down and comes to rest.
 *
 * Everything the Timeline component draws is derived here, so it can be
 * checked without a DOM. The grid is RadarCapability's: a step every five
 * minutes from two hours back to as far forward as the nowcast reaches, each
 * carrying the reflectivity at the point being asked about -- or nothing, when
 * no point has been shared.
 */
import type { GridConfig } from "../caps/RadarCapability";

/** One bar of the strip, in the order the scrubber plays them. */
export interface TimelineStep {
  /** The step, unix seconds. */
  t: number;
  /** Reflectivity at the point, or null where the grid has no reading. */
  dbz: number | null;
  /** A nowcast rather than an observation: drawn fainter. */
  forecast: boolean;
}

/**
 * The steps the scrubber may reach, oldest first.
 *
 * Truncated where the scrubber is, not where the grid is: the grid runs to
 * +2h but the tail of the nowcast is published behind it, and a bar nothing
 * can scrub to would only add flat space on the right. Numeric sort -- the
 * keys are 10-digit timestamps, so a lexicographic one would merely happen to
 * agree.
 */
export function timelineSteps(config: GridConfig, lastPlayable: number): TimelineStep[] {
  return Object.keys(config.grid)
    .map((key) => parseInt(key, 10))
    .filter((t) => t <= lastPlayable)
    .sort((a, b) => a - b)
    .map((t) => {
      const step = config.grid[t];
      const dbz = step?.dbz;
      return {
        t,
        dbz: dbz == null || Number.isNaN(dbz) ? null : Math.max(0, dbz),
        forecast: step != null && step.source !== "observation",
      };
    });
}

/**
 * Where the forecast starts, as a fraction of the strip, when there is none
 * at the point asked about -- and null whenever there is one, or nothing at
 * all. Outside DWD's grid the past comes from meteocool's own composites of
 * the neighbouring networks, which have no forecast, so the right half of
 * the strip is empty for a reason rather than because it will stay dry.
 */
export function forecastGapFrom(steps: TimelineStep[]): number | null {
  const first = steps.findIndex((step) => step.forecast);
  if (first <= 0) return null;
  const unknown = (step: TimelineStep) => step.dbz === null;
  if (!steps.slice(first).every(unknown)) return null;
  if (steps.slice(0, first).every(unknown)) return null;
  return first / steps.length;
}

/** Whether any step has measurable echo: the strip is worth bars at all. */
export function hasEcho(steps: TimelineStep[]): boolean {
  return steps.some((step) => step.dbz !== null && step.dbz > 0);
}

/**
 * The ceiling the bars are drawn against. 95 dBZ is the top of the colour
 * table, not a rainfall anyone sees: a typical shower peaks around 20, and
 * 45 is heavy rain. Taking the max with the peak means hail never clips.
 */
export function barCeiling(steps: TimelineStep[]): number {
  const peak = Math.max(0, ...steps.map((step) => step.dbz ?? 0));
  return Math.max(45, Math.ceil(peak));
}

/** A label on the axis under the strip. */
export interface AxisTick {
  /** Position along the strip, 0..1, centred on the step's bar. */
  at: number;
  /** Offset from now, in minutes. */
  minutes: number;
  /** The two ends are anchored flush rather than centred. */
  anchor: "start" | "end" | null;
}

/** How close to an end a regular label may sit before the end label wins. */
const AXIS_EDGE_CLEAR = 0.09;

/**
 * Where the axis is labelled.
 *
 * The ends are always labelled, whatever they land on: the right-hand one is
 * how far the forecast actually reaches, which is the nowcast's published
 * horizon rather than a round +2h. Between them, every `every` minutes,
 * skipping any that would collide with an end label.
 */
export function axisTicks(steps: TimelineStep[], now: number, every: number): AxisTick[] {
  const n = steps.length;
  if (n === 0) return [];
  const minutesAt = (index: number) => Math.round((steps[index].t - now) / 60);
  const ticks: AxisTick[] = [{ at: 0, minutes: minutesAt(0), anchor: "start" }];
  for (let i = 1; i < n - 1; i += 1) {
    const minutes = minutesAt(i);
    if (minutes % every !== 0) continue;
    const at = (i + 0.5) / n;
    if (at < AXIS_EDGE_CLEAR || at > 1 - AXIS_EDGE_CLEAR) continue;
    ticks.push({ at, minutes, anchor: null });
  }
  if (n > 1) ticks.push({ at: 1, minutes: minutesAt(n - 1), anchor: "end" });
  return ticks;
}

/** The index of the step at or just before `t`, clamped into the strip. */
export function indexOf(steps: TimelineStep[], t: number): number {
  if (steps.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].t <= t) index = i;
    else break;
  }
  return index;
}

/**
 * The needle's physics: a position in steps (fractional while moving), a
 * velocity in steps per millisecond, and the strip's two ends.
 *
 * A flick carries on past the finger and slows; the ends give way a little
 * and spring back, so running into one reads as the strip ending rather than
 * the drag failing. At rest the needle sits on a whole step, because that is
 * what the map can show.
 */
export interface Needle {
  pos: number;
  velocity: number;
}

/** Momentum's decay per millisecond: a flick glides about a quarter of the strip. */
export const FRICTION = 0.006;
/** How far past an end a drag may pull, in steps, before it stops giving. */
export const OVERSHOOT = 1.5;
/** Below this speed a glide is over, in steps per millisecond. */
export const AT_REST = 0.0005;

/** Clamp into the strip, with rubber-banding past the ends. */
export function rubberBand(pos: number, last: number): number {
  if (pos < 0) return -OVERSHOOT * (1 - 1 / (1 + -pos / OVERSHOOT));
  if (pos > last) return last + OVERSHOOT * (1 - 1 / (1 + (pos - last) / OVERSHOOT));
  return pos;
}

/** One frame of a glide: slow down, move, and stop dead at an end. */
export function glideStep(needle: Needle, dt: number, last: number): Needle {
  const velocity = needle.velocity * Math.exp(-FRICTION * dt);
  let pos = needle.pos + velocity * dt;
  if (pos <= 0 || pos >= last) {
    pos = Math.min(Math.max(pos, 0), last);
    return { pos, velocity: 0 };
  }
  return { pos, velocity: Math.abs(velocity) < AT_REST ? 0 : velocity };
}

/** Where a released needle comes to rest: the nearest whole step inside the strip. */
export function restingStep(pos: number, last: number): number {
  return Math.min(Math.max(Math.round(pos), 0), last);
}
