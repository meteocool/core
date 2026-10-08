/**
 * Whether the backend can be reached at all, as the API calls find it.
 *
 * The browser's `navigator.onLine` is the only other word on this, and it
 * only knows about the link it is on: a train in a tunnel, a captive portal,
 * a café's Wi-Fi with nothing behind it are all "online" to it, while every
 * request goes out and nothing comes back. Degraded is the wrong name for it
 * too: that describes a backend that answers badly, and this one does not
 * answer.
 *
 * So the calls keep score. Any answer, a 500 included, says the backend is
 * there. A call that got no answer at all (the network refused it, or it
 * stalled) says it is not, but only if nothing else has answered since that
 * call was sent: one stalled request among others that came back is a slow
 * request, not a dead connection.
 *
 * Self-clearing like the degraded criteria: the next answer clears it, and
 * there always is a next one, because a call that failed for the network's
 * sake is probed until it answers (lib/recovery.ts).
 *
 * Pure, with no store and no clock of its own. api/index.ts applies it to the
 * `reachability` store, which lib/connectionStatus.ts reads.
 */

export interface Reachability {
  /** When the backend last answered anything, ms; null before it has. */
  lastAnswerAt: number | null;
  /** Since when nothing has answered a call that went out, ms; null while something has. */
  unreachableSince: number | null;
  /** API calls under way, retries included: what a recovery is waiting on. */
  inFlight: number;
}

export const REACHABLE: Reachability = { lastAnswerAt: null, unreachableSince: null, inFlight: 0 };

/** A call has gone out. */
export function started(r: Reachability): Reachability {
  return { ...r, inFlight: r.inFlight + 1 };
}

/** A call is done, however it ended. */
export function finished(r: Reachability): Reachability {
  return { ...r, inFlight: Math.max(0, r.inFlight - 1) };
}

/** The backend answered something: it is there. */
export function answered(r: Reachability, now: number): Reachability {
  return { ...r, lastAnswerAt: now, unreachableSince: null };
}

/**
 * A call sent at `sentAt` got no answer at all, its retries spent.
 *
 * Unreachable only when nothing has answered since it went out; otherwise the
 * connection carried something else meanwhile, and this call was merely lost.
 */
export function unanswered(r: Reachability, sentAt: number, now: number): Reachability {
  if (r.lastAnswerAt !== null && r.lastAnswerAt >= sentAt) return r;
  if (r.unreachableSince !== null) return r;
  return { ...r, unreachableSince: now };
}
