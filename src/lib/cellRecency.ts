/**
 * How old a cell's readings are, and whether they match the radar under them.
 *
 * Everything the detail panel shows is one detection: the peak, the VIL, the
 * echo top, the 3D model of the storm's anatomy. The panel used to caption
 * that model "structure now", which is a claim rather than a reading -- these
 * arrive on DWD's own cadence and the newest one is always some minutes old.
 *
 * The second half matters more than the first. A reader comparing the panel's
 * numbers against the radar drawn behind it is comparing two products that are
 * published separately, and a cell detection can trail the composite by a frame
 * or more. When it does, the panel is describing a storm one step behind the
 * one painted under it, and nothing on screen said so.
 *
 * Pure and separate from the component, because the wording is the substance:
 * "same frame as the radar" and "5 min behind the radar" are different claims
 * about whether two things on screen can be compared at all.
 */

/** Below this the two products are on the same step and say so. */
export const SAME_FRAME_MINUTES = 2.5;

export interface Recency {
  /** Minutes since the detection, for "4 min ago". Negative is clamped away. */
  ageMinutes: number;
  /**
   * Minutes the detection trails the newest radar frame by, or null when there
   * is no frame to compare against -- no grid yet, or a view without radar.
   */
  behindMinutes: number | null;
}

/**
 * All times in milliseconds. `radarFrameMs` is the newest observation the grid
 * holds, or null when it holds none.
 */
export function cellRecency(
  lastSeenMs: number,
  nowMs: number,
  radarFrameMs: number | null,
): Recency {
  return {
    // A detection stamped slightly ahead of the clock is a clock difference,
    // not a reading from the future; it reports as current rather than negative.
    ageMinutes: Math.max(0, (nowMs - lastSeenMs) / 60_000),
    behindMinutes: radarFrameMs ? (radarFrameMs - lastSeenMs) / 60_000 : null,
  };
}

/**
 * The clause about the radar, or null when there is nothing to say.
 *
 * Null covers both no grid and the ordinary case of the two being on the same
 * step, which needs no sentence -- the panel is busy enough without a line
 * confirming that nothing is wrong.
 */
export function radarOffsetLabel(behindMinutes: number | null): string | null {
  if (behindMinutes === null) return null;
  if (Math.abs(behindMinutes) < SAME_FRAME_MINUTES) return null;
  const minutes = Math.round(Math.abs(behindMinutes));
  // Ahead happens when a detection lands before the composite it came from is
  // published. Rare, and worth saying plainly rather than rounding to zero.
  return behindMinutes > 0
    ? `${minutes} min behind the radar`
    : `${minutes} min ahead of the radar`;
}
