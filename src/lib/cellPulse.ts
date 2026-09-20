/**
 * The shape of the ping that marks a cell as still being detected.
 *
 * Kept free of OpenLayers, like cellGeometry.ts and for the same reason: the
 * fade curve is the part that decides whether a map with a dozen live cells
 * reads as a dozen pings or as a mess, and it is worth being able to state
 * that in a test rather than by looking at it.
 */

/**
 * How recently a cell must have been detected to count as live.
 *
 * Not `active`, although the schema has exactly that field and describes it as
 * "whether the cell was still being detected recently". On the live backend it
 * is true for every track returned -- 200 of 200 in one response, 147 of them
 * last detected more than fifteen minutes before the run's own reference time,
 * one of them eighty-five minutes before it. Whatever it means upstream, it
 * does not separate the storms still being seen from the ones that have
 * stopped, which is the only thing this needs.
 *
 * So the rule is the timestamp, measured against the cell feed's own newest
 * run rather than the clock -- the feed trails the radar by a frame, and
 * counting that lag against the budget would leave a cell that was detected in
 * the newest run available already half spent. Two runs at DWD's five-minute
 * cadence, which lets one missed detection pass without a live storm going
 * dark on the map.
 */
export const LIVE_MINUTES = 10;

/** Whether a cell's last detection is recent enough to ping. */
export function isLive(minutesSinceDetection: number): boolean {
  return minutesSinceDetection <= LIVE_MINUTES;
}

/** One full expand-and-fade, slow enough to read as a heartbeat. */
export const PERIOD_MS = 2200;

/** Where the ring starts and ends, in pixels around the centroid. */
export const RADIUS_FROM = 7;
export const RADIUS_TO = 24;

/** The ring at its strongest, which is the moment it leaves the marker. */
export const PEAK_ALPHA = 0.55;

/**
 * How many distinct frames a period is quantised to.
 *
 * The styles are cached per step, so this is also the size of the cache -- a
 * couple of dozen entries per severity rather than a new style object every
 * frame for every cell. Twenty is past the point where the steps are visible.
 */
export const STEPS = 20;

/**
 * The ring at one point in its cycle, with 0 the start and 1 the end.
 *
 * It grows linearly and fades on a square, so most of the fading happens late.
 * That is the whole design: the ring stays legible while it is still close to
 * the marker it belongs to, and is gone by the time it is far enough away to
 * be ambiguous about which cell it came from. Linear, a line of live cells
 * ends up inside each other's rings at full strength.
 */
export function pulseRing(phase: number): { radius: number; alpha: number } {
  return {
    radius: RADIUS_FROM + (RADIUS_TO - RADIUS_FROM) * phase,
    alpha: PEAK_ALPHA * (1 - phase) ** 2,
  };
}

/**
 * The step of the cycle a clock reading falls in, which is what gets cached.
 *
 * Off the wall clock rather than a per-cell timer, so every live cell pings
 * together. A map where each one runs its own cycle shimmers; one shared beat
 * reads as the map itself being live, which is the claim being made.
 */
export function pulseStep(nowMs: number): number {
  return Math.floor(((nowMs % PERIOD_MS) / PERIOD_MS) * STEPS);
}
