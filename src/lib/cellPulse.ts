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
 * Stepping costs a fraction of that. The ring never changes shape; it turns
 * one dash-width per tick, and a turn of one whole dash and gap looks the
 * same as no turn at all, so nine notches loop forever. A turn is a transform,
 * which the compositor animates without the page: no style, layout or paint
 * per tick, where the dash offset it replaced repainted every frame.
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

/**
 * The zoom from which a cell that is not live is drawn at all: its dot, its
 * path, its outline and the joins into it.
 *
 * Close in, an ended cell next to a live one is the storm's story -- where it
 * came from, what it split off. From a country away the two dots are a few
 * pixels apart and read as two storms, one of them with no ring and nothing
 * under it. The open cell is drawn whatever the zoom.
 */
export const ENDED_MIN_ZOOM = 10;

/** Web Mercator's metres per pixel at zoom 0. */
const RESOLUTION_AT_ZOOM_0 = 156_543.033_928_041;

/** Whether the map, at this resolution, is close enough in to draw cells that are not live. */
export function showsEnded(resolution: number): boolean {
  // A hair of slack, so a view resting exactly on the zoom counts as on it.
  return resolution <= (RESOLUTION_AT_ZOOM_0 / 2 ** ENDED_MIN_ZOOM) * 1.001;
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
 * The ring's length as the dash pattern measures it: a whole number of dash
 * periods. The circle itself is 2π × 11 ≈ 69 px round, 7.7 periods, which
 * leaves a stub of a dash where its path starts and ends; laid on a path
 * length of eight periods instead (SVG's `pathLength`), the dashes shrink by
 * four percent and close up without a seam, so turning the ring shows no join.
 */
export const RING_PATH_LENGTH = Math.round((2 * Math.PI * RING_RADIUS) / DASH_PERIOD) * DASH_PERIOD;

/** One notch, as an angle: a dash-width of the path length. */
export const NOTCH_DEGREES = 360 / RING_PATH_LENGTH;

/**
 * How far round the ring is turned at a given moment, in degrees clockwise --
 * the way the pattern is read, rather than appearing to slide backwards.
 *
 * Driven off the wall clock rather than a per-cell counter, so every live cell
 * steps together: a map where each one runs its own cycle shimmers, where one
 * shared beat reads as the map itself being live.
 */
export function ringAngle(nowMs: number): number {
  return (Math.floor(nowMs / TICK_MS) % DASH_PERIOD) * NOTCH_DEGREES;
}

/** Where the rings were last laid out: the view's scale and turn, and which cells. */
export interface RingLayout {
  resolution: number;
  rotation: number;
  /** The source's revision: a cell added, removed or moved changes it. */
  revision: number;
}

/**
 * Whether the map has only slid since the rings were laid out, so that moving
 * them all together is moving each one where it belongs.
 *
 * A pan moves every point on screen by the same amount; a zoom or a turn moves
 * each by its own, and a new or vanished cell changes which rings there are.
 */
export function onlySlid(laid: RingLayout | null, now: RingLayout): boolean {
  return laid !== null
    && laid.resolution === now.resolution
    && laid.rotation === now.rotation
    && laid.revision === now.revision;
}
