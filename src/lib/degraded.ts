/**
 * What "Degraded" means, in one place.
 *
 * The pill used to ask `isDegraded(apiHealth)` directly, so the state was
 * whatever that one function happened to cover -- failed API calls, and nothing
 * else. Latency, a backend that had stopped publishing, and every later
 * criterion had nowhere to go but another condition bolted onto another
 * component. This module is the answer to "what puts the map in that state",
 * and it is the only answer: the pill and the diagnostics both read it.
 *
 * Every criterion is written to be *self-clearing*. None of them latch, none of
 * them count events that already happened, and none of them need anything to
 * decide an incident is over: each one reads a signal that is true now and
 * false again the moment the backend recovers. That is the property to preserve
 * when adding one -- a criterion that can only be switched off by something
 * remembering to switch it off will eventually stay on forever.
 *
 * Pure, with no store and no clock of its own. The wiring that samples the
 * signals and publishes the verdict is lib/degradedStatus.ts.
 */
import { EMPTY_HEALTH, type ApiHealth } from "./apiHealth";

/**
 * Everything the criteria are allowed to look at, sampled at one instant.
 *
 * Passed in rather than read, so the rules can be exercised directly and so it
 * is obvious what the state actually depends on.
 */
export interface DegradedSignals {
  /** Which endpoints are failing, and when they last did. */
  health: ApiHealth;
  /** p95 response time over the recent window, in ms; null without samples. */
  recentP95Ms: number | null;
  /** How many responses that p95 was taken over. */
  recentSamples: number;
  /**
   * How late the backend's next publish is, in seconds, against the cadence
   * learned from its own history. Negative while it is still due, null while
   * there is no pattern yet.
   */
  publishOverdueS: number | null;
}

export const EMPTY_SIGNALS: DegradedSignals = {
  // The same empty health the module that defines it publishes, rather than a
  // copy of its shape: a second field on `ApiHealth` should not mean two places
  // to remember.
  health: EMPTY_HEALTH,
  recentP95Ms: null,
  recentSamples: 0,
  publishOverdueS: null,
};

/**
 * How long a failure keeps the warning up with nothing retrying it.
 *
 * A route only leaves `failing` when a later call to it succeeds, and nothing
 * calls a layer you have switched away from. Without this the pill would warn
 * for the rest of the session about an endpoint nobody is using. Anything still
 * being retried keeps refreshing lastFailureAt, so a backend that is genuinely
 * down stays flagged for as long as it is down.
 */
export const DEGRADED_TTL_MS = 5 * 60 * 1000;

/** Whether the API is currently failing in a way worth saying so about. */
export function isApiDegraded(health: ApiHealth, now: number = Date.now()): boolean {
  if (!health.failing.length || health.lastFailureAt === null) return false;
  return now - health.lastFailureAt < DEGRADED_TTL_MS;
}

/**
 * Slow enough that the map is visibly not working, measured at p95 over the
 * recent window rather than on any one request: a single four-second tile on a
 * train is not a degraded backend, and flagging it would make the pill mean
 * nothing. Well above the panel's own LATENCY_BAD_MS, which marks a row amber
 * for someone already reading diagnostics -- a different, cheaper claim.
 */
export const SLOW_P95_MS = 4000;

/** Below this the p95 is one or two requests wearing a percentile's hat. */
export const SLOW_MIN_SAMPLES = 5;

/**
 * How far past its own expected publish the backend has to be.
 *
 * A whole extra cycle on top of the prediction, so an ordinary few seconds of
 * pipeline jitter is not an incident. The cadence is learned, so this scales
 * with whatever the backend is actually doing.
 */
export const PUBLISH_OVERDUE_S = 300;

/** A tripped criterion, in the words the diagnostics panel prints. */
export interface DegradedReason {
  id: string;
  detail: string;
}

export interface DegradedCriterion {
  id: string;
  /** What the panel calls it when it is not tripped. */
  label: string;
  /** Why it is tripped right now, or null. */
  reason(signals: DegradedSignals, now: number): string | null;
}

/** The whole definition. Adding a criterion means adding it here, and only here. */
export const DEGRADED_CRITERIA: DegradedCriterion[] = [
  {
    id: "api-errors",
    label: "backend errors",
    /* Clears itself twice over: an endpoint leaves `failing` as soon as one
       call to it succeeds, and the whole thing ages out after DEGRADED_TTL_MS
       for a route nothing is retrying any more. */
    reason: (s, now) => (isApiDegraded(s.health, now)
      ? `failing: ${s.health.failing.join(", ")}`
      : null),
  },
  {
    id: "slow-responses",
    label: "response times",
    /* Clears itself because the window is recent: once the fast responses
       outnumber the slow ones the p95 comes back down on its own, with nothing
       to reset. */
    reason: (s) => (
      s.recentSamples >= SLOW_MIN_SAMPLES
        && s.recentP95Ms !== null
        && s.recentP95Ms >= SLOW_P95_MS
        ? `p95 ${Math.round(s.recentP95Ms)} ms over ${s.recentSamples} responses`
        : null
    ),
  },
  {
    id: "stale-publish",
    label: "publish cadence",
    /* Clears itself on the next frame that lands, because the overdue figure is
       measured from the newest publish rather than from when we noticed. */
    reason: (s) => (
      s.publishOverdueS !== null && s.publishOverdueS >= PUBLISH_OVERDUE_S
        ? `no new frame for ${Math.round(s.publishOverdueS / 60)}m past the expected time`
        : null
    ),
  },
];

/** What the map is currently saying, and why. */
export interface DegradedState {
  degraded: boolean;
  reasons: DegradedReason[];
}

export const NOT_DEGRADED: DegradedState = { degraded: false, reasons: [] };

export function evaluateDegraded(
  signals: DegradedSignals,
  now: number = Date.now(),
): DegradedState {
  const reasons: DegradedReason[] = [];
  for (const criterion of DEGRADED_CRITERIA) {
    const detail = criterion.reason(signals, now);
    if (detail) reasons.push({ id: criterion.id, detail });
  }
  return { degraded: reasons.length > 0, reasons };
}
