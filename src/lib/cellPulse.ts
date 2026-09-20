/**
 * The mark that says a cell is still being detected.
 *
 * A ring of dashes around the centroid, stepping round it a notch at a time.
 * It replaced an expanding-and-fading ping, which read well but cost too much
 * to draw: that one changed the ring's radius and opacity every frame, so
 * every live cell's style had to be rebuilt twenty times a second, and on a
 * viewport with a hundred of them the animation was visibly not keeping up --
 * an animation that stutters says "this page is struggling", which is the
 * opposite of "this storm is live".
 *
 * Stepping costs a fraction of that. The ring never changes shape; only the
 * dash pattern's offset moves, one dash-width per tick, so the whole thing is
 * a handful of prebuilt styles cycled in order. Five ticks a second against
 * twenty, and nine distinct styles per colour against a new one every frame.
 *
 * The step is also the point rather than a compromise. Smooth rotation at this
 * size reads as a shimmer; a notch reads as a mechanism running -- a second
 * hand rather than a sweep -- which is the claim being made.
 *
 * Kept free of OpenLayers, like cellGeometry.ts, so the cycle can be stated in
 * a test rather than watched.
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

/** Whether a cell's last detection is recent enough to mark as live. */
export function isLive(minutesSinceDetection: number): boolean {
  return minutesSinceDetection <= LIVE_MINUTES;
}

/** The ring, in pixels: clear of the largest centroid marker, which is 12 across. */
export const RING_RADIUS = 11;
export const RING_WIDTH = 2;

/**
 * Dash and gap.
 *
 * Their sum is the distance the pattern has to travel to look the same again,
 * so it is also the number of notches in a full turn -- nine, at five a
 * second, is a turn every 1.8 seconds.
 */
export const DASH: [number, number] = [5, 4];
export const DASH_PERIOD = DASH[0] + DASH[1];

/** One notch per tick. Slow enough to see the step, quick enough to look alive. */
export const TICK_MS = 200;

/**
 * Where the dash pattern starts, for a given moment.
 *
 * Negative, so the dashes travel the way the pattern is read rather than
 * appearing to slide backwards. Driven off the wall clock rather than a
 * per-cell counter, so every live cell steps together: a map where each one
 * runs its own cycle shimmers, where one shared beat reads as the map itself
 * being live.
 */
export function dashOffset(nowMs: number): number {
  return -(Math.floor(nowMs / TICK_MS) % DASH_PERIOD);
}
