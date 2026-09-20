/**
 * Whether the frames the client is holding have been overtaken by the clock.
 *
 * This is not the same question as lib/degraded.ts's "stale-publish", and the
 * two must not be conflated. That one asks whether the *backend* has stopped
 * producing, measured against its own history, and it is a claim about the
 * service. This one asks whether *we* are behind: the newest frame we hold is
 * older than one publish cycle, so something newer almost certainly exists and
 * we have not fetched it. The usual cause is that we were not running -- a tab
 * in the background, a phone with the screen locked -- and nothing was there to
 * receive the websocket poke that would normally have refreshed us.
 *
 * Self-clearing in the same sense as the degraded criteria: it is a function of
 * the newest frame held and the current time, so the next grid that lands turns
 * it off with nothing having to remember to.
 *
 * Pure, with no store and no clock of its own. The wiring is in RadarCapability,
 * which is where the grid is.
 */
import type { Cadence } from "./updateCadence";

/**
 * The cycle to assume before the session has learned one.
 *
 * The composite is nominally five-minutely, and on a cold start there is no
 * observed rhythm to use instead. Only a fallback: once publishCadence() has
 * enough samples, the measured period wins, which is what makes this work on a
 * staging backend running at some other rate.
 */
export const ASSUMED_PERIOD_S = 300;

/**
 * How far past a full cycle the newest frame has to be.
 *
 * A frame is expected to be up to one cycle old -- that is what it means to be
 * the newest one. Only past that is it evidence of a frame we are missing, and
 * the grace absorbs the ordinary few seconds of pipeline lag on top so an
 * ordinary foreground moment does not flash the map as outdated.
 */
export const OUTDATED_GRACE_S = 60;

/** The cycle length to judge against: the observed one, else the nominal. */
export function expectedPeriodS(cadence: Cadence): number {
  return cadence.periodS && cadence.periodS > 0 ? cadence.periodS : ASSUMED_PERIOD_S;
}

/**
 * Whether the newest frame held is old enough that a newer one must exist.
 *
 * Times are epoch seconds, like the grid's own. A null or non-positive newest
 * means there is no grid yet, which is a different state -- still loading, not
 * outdated -- and reports false.
 */
export function isOutdated(
  newestFrameS: number | null,
  nowS: number,
  cadence: Cadence,
): boolean {
  if (!newestFrameS || newestFrameS <= 0) return false;
  return nowS - newestFrameS > expectedPeriodS(cadence) + OUTDATED_GRACE_S;
}
