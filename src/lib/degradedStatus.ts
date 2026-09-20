import { get } from "svelte/store";
import { apiHealth, degradedStatus, radarCadence } from "../stores";
import { evaluateDegraded, type DegradedSignals } from "./degraded";
import { summariseRequests } from "./requestTiming";
import { overdueBy } from "./updateCadence";

/**
 * Sampling the signals lib/degraded.ts judges, and publishing the verdict.
 *
 * Split from the rules the way networkStatus.ts is split from networkQuality.ts:
 * everything here touches a store, a clock or the performance timeline, and
 * everything there is a pure function of what this hands it.
 *
 * The re-check timer is the thing that makes the state recover on its own. The
 * criteria are all written to stop being true once the backend is healthy, but
 * two of them -- an ageing-out failure and an overdue publish -- change with
 * nothing but the passage of time, and the third only moves as requests land.
 * Re-evaluating only when apiHealth changed meant a state that had become false
 * could stay on the map until the next call happened to fail or succeed.
 */

/** How often the criteria are asked again. */
export const RECHECK_MS = 5000;

/**
 * How far back "recent" reaches for the latency criterion.
 *
 * Long enough to hold a useful number of responses on a quiet map, short enough
 * that a backend which got better two minutes ago is no longer being judged on
 * how it was before.
 */
export const LATENCY_WINDOW_MS = 120_000;

/** Our own API, not tiles or the basemap: this is a claim about the backend. */
const API_MATCH = /\/v3\//;

/** Everything the criteria look at, read at one instant. */
export function readDegradedSignals(now: number = Date.now()): DegradedSignals {
  const recent = summariseRequests(API_MATCH, LATENCY_WINDOW_MS);
  return {
    health: get(apiHealth),
    recentP95Ms: recent.p95Ms,
    recentSamples: recent.count,
    // The grid's timestamps are epoch seconds, so the comparison is too.
    publishOverdueS: overdueBy(get(radarCadence), Math.round(now / 1000)),
  };
}

export function refreshDegradedStatus() {
  const now = Date.now();
  const next = evaluateDegraded(readDegradedSignals(now), now);
  degradedStatus.update((current) => (
    /* Same verdict, same reasons: hand back the old object so a pill that is
       already saying this is not re-rendered every five seconds. */
    current.degraded === next.degraded
      && current.reasons.length === next.reasons.length
      && current.reasons.every((r, i) => r.id === next.reasons[i].id
        && r.detail === next.reasons[i].detail)
      ? current
      : next
  ));
}

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Start tracking. Idempotent: the entrypoints and a hot reload can both reach
 * it, and stacking timers here would be invisible until the pill flickered.
 */
export function initDegradedStatus() {
  cleanupDegradedStatus();
  refreshDegradedStatus();
  // A call that has just failed should show immediately rather than up to
  // RECHECK_MS later; the timer is for the criteria that move on their own.
  unsubscribe = apiHealth.subscribe(() => refreshDegradedStatus());
  if (typeof window === "undefined") return;
  timer = setInterval(refreshDegradedStatus, RECHECK_MS);
}

export function cleanupDegradedStatus() {
  if (timer) clearInterval(timer);
  timer = null;
  unsubscribe?.();
  unsubscribe = null;
}
