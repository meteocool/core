/**
 * How a call's outcome changes what we know about the backend.
 *
 * Pure, with no store and no client of its own, so it can be exercised
 * directly -- same arrangement as networkQuality.ts. The wiring that applies it
 * lives in api/index.ts, which is where the requests are.
 *
 * Only the bookkeeping. Whether any of this amounts to a warning on the map is
 * lib/degraded.ts's question, along with every other criterion -- keeping the
 * answer here is what made "degraded" mean "an API call failed" and nothing
 * else for as long as it did.
 */

/** What the backend has been doing, for the status pill and the diagnostics. */
export interface ApiHealth {
  /** Every failed call since load, however many endpoints they came from. */
  failures: number;
  /** Failures per endpoint, so one broken route is distinguishable from many. */
  byEndpoint: Record<string, number>;
  /** Endpoints whose most recent attempt failed; empty once they all recover. */
  failing: string[];
  /**
   * Endpoints whose most recent attempt found nothing there; see `markAbsent`.
   *
   * Kept apart from `failing` because it is a different claim about the
   * backend, and only one of them is a fault.
   */
  absent: string[];
  lastFailureAt: number | null;
  lastMessage: string | null;
}

export const EMPTY_HEALTH: ApiHealth = {
  failures: 0,
  byEndpoint: {},
  failing: [],
  absent: [],
  lastFailureAt: null,
  lastMessage: null,
};

/** Without `id`, or unchanged when it was not in there. */
const without = (list: string[], id: string): string[] => (
  list.includes(id) ? list.filter((other) => other !== id) : list
);

/**
 * `failing` holds the endpoints whose LAST attempt failed, which is what makes
 * the degraded state self-clearing: nothing has to decide when an outage is
 * over, the next call that works says so.
 *
 * The counts are cumulative and deliberately never reset -- "it failed twice an
 * hour ago and has been fine since" is worth seeing in the diagnostics even
 * though it is not worth a warning on the map.
 */
export function nextHealth(
  health: ApiHealth,
  id: string,
  error?: unknown,
  now: number = Date.now(),
): ApiHealth {
  if (!error) {
    // Recovery touches nothing but this endpoint's membership, so a success
    // elsewhere cannot clear a warning about a route that is still down.
    if (!health.failing.includes(id) && !health.absent.includes(id)) return health;
    return { ...health, failing: without(health.failing, id), absent: without(health.absent, id) };
  }
  return {
    failures: health.failures + 1,
    byEndpoint: { ...health.byEndpoint, [id]: (health.byEndpoint[id] ?? 0) + 1 },
    failing: health.failing.includes(id) ? health.failing : [...health.failing, id],
    // An endpoint that has started erroring is no longer merely empty.
    absent: without(health.absent, id),
    lastFailureAt: now,
    lastMessage: error instanceof Error ? error.message : String(error),
  };
}

/**
 * An endpoint that answered "there is nothing here", which is not a fault.
 *
 * Some of what the map draws is published on a timer of its own and simply is
 * not there yet -- the Swiss composite is captured every fifteen minutes by an
 * ingest that runs whether or not this app exists, and answers 404 until the
 * first one lands. Counted as a failure, that put the map in its degraded
 * state and raised "Something went wrong" over a layer that was working
 * exactly as designed, for as long as the upstream had nothing to give.
 *
 * So it is recorded, because "why is there no Swiss radar" deserves an answer
 * in the diagnostics, and it is recorded somewhere the degraded criteria do
 * not look. It clears the same way every other signal here does: the next
 * attempt that finds something, or fails properly, says so.
 *
 * Only for endpoints whose absence is an ordinary state. A route that has to
 * be there and is not is a fault, and `nextHealth` is where that goes.
 */
export function markAbsent(health: ApiHealth, id: string): ApiHealth {
  if (health.absent.includes(id) && !health.failing.includes(id)) return health;
  return {
    ...health,
    failing: without(health.failing, id),
    absent: health.absent.includes(id) ? health.absent : [...health.absent, id],
  };
}
