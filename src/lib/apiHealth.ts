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
  lastFailureAt: number | null;
  lastMessage: string | null;
}

export const EMPTY_HEALTH: ApiHealth = {
  failures: 0,
  byEndpoint: {},
  failing: [],
  lastFailureAt: null,
  lastMessage: null,
};

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
    if (!health.failing.includes(id)) return health;
    return { ...health, failing: health.failing.filter((e) => e !== id) };
  }
  return {
    failures: health.failures + 1,
    byEndpoint: { ...health.byEndpoint, [id]: (health.byEndpoint[id] ?? 0) + 1 },
    failing: health.failing.includes(id) ? health.failing : [...health.failing, id],
    lastFailureAt: now,
    lastMessage: error instanceof Error ? error.message : String(error),
  };
}
