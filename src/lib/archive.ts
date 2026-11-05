/**
 * The archive: a past window on the map, as numbers.
 *
 * A reader picks a window in the month the backend keeps (`/v3/archive`) and
 * uses the map in it as live: the timeline spans the window, every overlay
 * that has a past answers for the step on screen, and what has none is
 * hidden. "A window is open" is archive mode; null is live.
 *
 * Everything here is pure: which steps a window holds, how the strip is
 * labelled in clock times, which three-hour pieces of strikes a step needs
 * and which of them are drawn, how a window is written into a link, and what
 * the map hides while one is open. The wiring is RadarCapability, the player,
 * App.svelte and lib/urlState.ts.
 */

/** The grid every step is on: five minutes, in seconds. */
export const STEP_S = 300;

/** The lengths a window can be picked in, in hours. */
export const WINDOW_HOURS = [1, 3, 6, 12, 24] as const;
export type WindowHours = (typeof WINDOW_HOURS)[number];

/** The length the picker starts on. */
export const DEFAULT_WINDOW_HOURS: WindowHours = 3;

/** The most steps the timeline route serves in one window. */
export const MAX_WINDOW_STEPS = 1000;

/** How long a window opened from a link naming one frame is: two hours, ending on it. */
export const AROUND_FRAME_S = 2 * 60 * 60;

/** The longest span `/v3/lightning/strikes` answers for. */
export const STRIKE_CHUNK_S = 3 * 60 * 60;

/** How far back from the step on screen strikes are drawn: the live map's half hour. */
export const STRIKE_SPAN_S = 30 * 60;

/** A past window: its first and last step, unix seconds on the five-minute grid, both shown. */
export interface ArchiveWindow {
  start: number;
  end: number;
}

/** What the archive covers, as `/v3/archive` says: its oldest and newest observed step. */
export interface ArchiveCoverage {
  since: number;
  until: number;
}

/** `t` on the five-minute grid, at or before it. */
export function onGrid(t: number): number {
  return t - (((t % STEP_S) + STEP_S) % STEP_S);
}

/**
 * Whether `window` is one the timeline can serve: both ends whole steps on
 * the grid, the end after the start, and no more steps than the route takes.
 */
export function isWindow(window: ArchiveWindow | null | undefined): window is ArchiveWindow {
  if (!window) return false;
  const { start, end } = window;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (onGrid(start) !== start || onGrid(end) !== end || end <= start) return false;
  return (end - start) / STEP_S + 1 <= MAX_WINDOW_STEPS;
}

/** Whether two windows are the same one; null is live. */
export function sameWindow(a: ArchiveWindow | null | undefined, b: ArchiveWindow | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.start === b.start && a.end === b.end;
}

/** Every step of a window, oldest first, both ends included. */
export function windowSteps(window: ArchiveWindow): number[] {
  const steps: number[] = [];
  for (let t = window.start; t <= window.end; t += STEP_S) steps.push(t);
  return steps;
}

/** Whether `t` is a step the window holds. */
export function inWindow(window: ArchiveWindow, t: number): boolean {
  return t >= window.start && t <= window.end && onGrid(t) === t;
}

/**
 * The window a reader picked: from `start`, `hours` long, kept inside what
 * the archive covers. One running past the newest step ends there; one
 * starting before the oldest starts there. Null when nothing of it is kept.
 */
export function pickWindow(start: number, hours: number, coverage: ArchiveCoverage): ArchiveWindow | null {
  const from = Math.max(onGrid(start), coverage.since);
  const to = Math.min(onGrid(start) + hours * 3600, coverage.until);
  const window = { start: from, end: to };
  return isWindow(window) ? window : null;
}

/**
 * The window a link naming only a frame opens on, when the frame is older
 * than the live timeline holds but the archive keeps it: two hours, ending
 * on the frame, its start kept inside the archive. Null outside the archive.
 */
export function windowAround(t: number, coverage: ArchiveCoverage): ArchiveWindow | null {
  const end = onGrid(t);
  if (end !== t || end < coverage.since || end > coverage.until) return null;
  const window = { start: Math.max(end - AROUND_FRAME_S, coverage.since), end };
  return isWindow(window) ? window : null;
}

/** Whether a link's window can be opened at `nowS`: a window, and over by then. */
export function acceptsWindow(window: ArchiveWindow | null | undefined, nowS: number): window is ArchiveWindow {
  return isWindow(window) && window.end <= onGrid(nowS);
}

/* ---- the picker --------------------------------------------------------- */

/**
 * The days the picker offers, each as the epoch milliseconds of its local
 * midnight, oldest first: every day with anything kept. `startOfDay` and
 * `nextDay` are the reader's calendar (date-fns's), handed in so this stays
 * free of a time zone.
 */
export function coverageDays(
  coverage: ArchiveCoverage,
  startOfDay: (ms: number) => number,
  nextDay: (ms: number) => number,
): number[] {
  const days: number[] = [];
  const last = startOfDay(coverage.until * 1000);
  for (let day = startOfDay(coverage.since * 1000); day <= last; day = nextDay(day)) days.push(day);
  return days;
}

/**
 * The minutes of the day a window may start at on a day, on the grid, as
 * [first, last]: the whole day, cut at the archive's ends on its first and
 * last day. `minuteOf` is the reader's clock, minutes since that midnight.
 */
export function startMinutes(
  day: number,
  coverage: ArchiveCoverage,
  minuteOf: (ms: number) => number,
  startOfDay: (ms: number) => number,
): [number, number] {
  const first = startOfDay(coverage.since * 1000) === day ? Math.ceil(minuteOf(coverage.since * 1000) / 5) * 5 : 0;
  const last = startOfDay(coverage.until * 1000) === day ? Math.floor(minuteOf(coverage.until * 1000) / 5) * 5 : 1435;
  return [first, Math.max(first, last)];
}

/* ---- the timeline ------------------------------------------------------- */

/** A label on a window's axis: a clock time, with the date where the day changes. */
export interface WindowTick {
  /** Position along the strip, 0..1, centred on the step's bar. */
  at: number;
  /** The step, unix seconds. */
  t: number;
  /** The two ends are anchored flush rather than centred. */
  anchor: "start" | "end" | null;
  /** Whether the label carries the date: a window across midnight, on each day's first label. */
  withDate: boolean;
}

/** How close to an end a regular label may sit before the end label wins; as `axisTicks`. */
const AXIS_EDGE_CLEAR = 0.09;

/** How often a window's axis is labelled, in minutes: the live strip's spacing, wider for a long window. */
export function windowLabelEvery(steps: number, base: number, most: number): number {
  const minutes = Math.max(0, steps - 1) * (STEP_S / 60);
  for (const every of [base, 60, 120, 180, 360, 720]) {
    if (every >= base && minutes / every <= most) return every;
  }
  return 720;
}

/**
 * Where a window's axis is labelled, in clock times rather than offsets:
 * both ends, and between them every `every` minutes of the clock, skipping
 * any that would collide with an end. `dayOf` is the reader's calendar day
 * of a step, any value two steps on one day share.
 */
export function windowTicks(steps: readonly number[], every: number, dayOf: (t: number) => number | string): WindowTick[] {
  const n = steps.length;
  if (n === 0) return [];
  const crosses = dayOf(steps[0]) !== dayOf(steps[n - 1]);
  const ticks: Omit<WindowTick, "withDate">[] = [{ at: 0, t: steps[0], anchor: "start" }];
  for (let i = 1; i < n - 1; i += 1) {
    if (steps[i] % (every * 60) !== 0) continue;
    const at = (i + 0.5) / n;
    if (at < AXIS_EDGE_CLEAR || at > 1 - AXIS_EDGE_CLEAR) continue;
    ticks.push({ at, t: steps[i], anchor: null });
  }
  if (n > 1) ticks.push({ at: 1, t: steps[n - 1], anchor: "end" });
  let day: number | string | null = null;
  return ticks.map((tick) => {
    const today = dayOf(tick.t);
    const withDate = crosses && today !== day;
    day = today;
    return { ...tick, withDate };
  });
}

/** The frame after `shown` in a window's playback: on through it, and round to its start from its last. */
export function nextWindowFrame(shown: number, window: ArchiveWindow, last = window.end): number {
  if (shown < window.start || shown >= last) return window.start;
  return shown + STEP_S;
}

/* ---- strikes ------------------------------------------------------------ */

/** One request's worth of strikes: `[since, until)`, unix seconds. */
export interface StrikeChunk {
  since: number;
  until: number;
}

/**
 * The pieces of `/v3/lightning/strikes` that cover `[from, to)`, each on the
 * three-hour grid so the same piece is asked for, and cached, from any step
 * in it; the last cut at `cap`, the newest moment there can be strikes for.
 */
export function strikeChunks(from: number, to: number, cap = Infinity): StrikeChunk[] {
  const chunks: StrikeChunk[] = [];
  const end = Math.min(to, cap);
  for (let since = from - (((from % STRIKE_CHUNK_S) + STRIKE_CHUNK_S) % STRIKE_CHUNK_S); since < end; since += STRIKE_CHUNK_S) {
    chunks.push({ since, until: Math.min(since + STRIKE_CHUNK_S, cap) });
  }
  return chunks;
}

/**
 * The pieces a step needs drawn: the half hour up to it, and the step itself.
 * `cap` is where the window's strikes end, a step after its last.
 */
export function chunksFor(shown: number, cap: number): StrikeChunk[] {
  return strikeChunks(shown - STRIKE_SPAN_S, shown + 1, cap);
}

/** A strike as the archive lists it: projected metres, and its time in milliseconds. */
export interface ArchivedStrike {
  lon: number;
  lat: number;
  time_wall: number;
}

/** The strikes drawn on a step: those of the half hour up to it, its own moment included. */
export function strikesAt<S extends { time_wall: number }>(strikes: readonly S[], shown: number): S[] {
  const until = shown * 1000;
  const since = until - STRIKE_SPAN_S * 1000;
  return strikes.filter((strike) => strike.time_wall > since && strike.time_wall <= until);
}

/** How old a strike is on a step, in minutes; what its mark fades by, as live ones fade by the clock. */
export function strikeAgeMinutes(timeMs: number, shown: number): number {
  return Math.max(0, (shown * 1000 - timeMs) / 60_000);
}

/* ---- what a window shows ------------------------------------------------ */

/**
 * What the map draws live that has no past, and hides in a window: the
 * forecast, the chart's point reading, site mode and the radars' marks that
 * open it, the 3D map, the "3D" tags beside storm cores, and the
 * mesocyclones. Everything else answers for the step on screen.
 */
export const NO_PAST = ["forecast", "chart", "sites", "cells3d", "cloudHints", "mesocyclones"] as const;
export type NoPast = (typeof NO_PAST)[number];

/** Whether `feature` is drawn: always live, and in a window only if it has a past. */
export function shownIn(window: ArchiveWindow | null, feature: NoPast | string): boolean {
  return window === null || !(NO_PAST as readonly string[]).includes(feature);
}

/** Whether a map can be switched to in a window: every one but the 3D map. */
export function mapInWindow(layer: string, window: ArchiveWindow | null): boolean {
  return window === null || layer !== "cells3d";
}
