/**
 * A rolling window of resource timings, for the diagnostics panel.
 *
 * Not performance.getEntriesByType("resource"): that reads a buffer capped at
 * 250 entries which stops recording once full, and a session that has panned
 * the map fills it within the first minute. A PerformanceObserver is not capped,
 * so this keeps its own window of the most recent entries instead.
 *
 * Deliberately just a ring buffer of what the browser already measured -- it
 * issues no requests of its own, so opening the panel cannot change the numbers
 * it is reporting.
 */

const MAX_ENTRIES = 400;

let entries: PerformanceResourceTiming[] = [];
let observer: PerformanceObserver | null = null;

export interface TimingSummary {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
  lastMs: number | null;
  transferredBytes: number;
  fromCache: number;
  oldestAgeMs: number | null;
}

export function initRequestTiming() {
  cleanupRequestTiming();
  if (typeof PerformanceObserver === "undefined") return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      entries.push(entry as PerformanceResourceTiming);
    }
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  });
  try {
    // `buffered` replays whatever the browser already had, so the window is not
    // empty for a panel opened straight after load.
    observer.observe({ type: "resource", buffered: true });
  } catch {
    observer = null;
  }
}

export function cleanupRequestTiming() {
  observer?.disconnect();
  observer = null;
  entries = [];
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * Summarise the observed requests whose URL matches.
 *
 * `sinceMs` narrows the window to the requests that started that recently,
 * which is what a criterion watching for recovery needs: a summary over the
 * whole ring buffer still carries an outage that ended ten minutes ago, so
 * nothing computed from it can ever clear. Omitted, the whole window is used --
 * which is what the diagnostics panel's own rows want.
 */
export function summariseRequests(match: RegExp, sinceMs?: number): TimingSummary {
  const floor = sinceMs == null ? null : performance.now() - sinceMs;
  const matched = entries.filter(
    (e) => match.test(e.name) && (floor === null || e.startTime >= floor),
  );
  const durations = matched.map((e) => e.duration).sort((a, b) => a - b);
  const last = matched[matched.length - 1];
  return {
    count: matched.length,
    medianMs: quantile(durations, 0.5),
    p95Ms: quantile(durations, 0.95),
    slowestMs: durations.length ? durations[durations.length - 1] : null,
    lastMs: last ? last.duration : null,
    transferredBytes: matched.reduce((sum, e) => sum + (e.transferSize || 0), 0),
    // A response served from cache reports transferSize 0 with a real body.
    fromCache: matched.filter((e) => e.transferSize === 0 && e.decodedBodySize > 0).length,
    oldestAgeMs: matched.length
      ? Math.round(performance.now() - matched[0].startTime)
      : null,
  };
}
