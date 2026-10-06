/**
 * The connection to the backend, as one state machine.
 *
 * ```
 *   from          on                                  to
 *   any           cut off                             offline
 *   online        degraded                            degraded
 *   degraded      degraded clears                     catching-up
 *   offline       reached again                       catching-up
 *   catching-up   settled or timed out, healthy       online
 *   catching-up   settled or timed out, degraded      degraded
 * ```
 *
 * - **online**: nothing to say; the freshness and the connection's speed
 *   are the pill's business from here (components/LiveIndicator.svelte).
 * - **degraded**: the backend answers, badly; lib/degraded.ts says how.
 * - **offline**: nothing can be refreshed. The browser knows it has no
 *   network, or nothing the app sent has been answered since it went out
 *   (lib/reachability.ts) -- which the browser does not know about a tunnel
 *   or a captive portal. Outranks everything: from any state, cut off is
 *   offline.
 * - **catching-up**: on the way back out of either. What the outage took
 *   away is being fetched again -- the wake that a recovery sets off
 *   (lib/recovery.ts) refetches everything -- and until it has landed, the map
 *   still shows what it showed before. It holds while calls are under way or
 *   the radar is behind the clock, for at least CATCH_UP_MIN_MS and at most
 *   CATCH_UP_MAX_MS, and then settles on what the signals say: online, or
 *   degraded if it still is.
 *
 * Coming back from offline goes through catching-up even while the degraded
 * criteria are tripped. They are, as a rule: every call that failed in the
 * outage left its endpoint failing, and only refetching it clears that. So
 * degraded is judged only once the refetch has settled.
 *
 * Pure: the current state, the signals at one instant and the time in; the
 * next state out. The wiring that samples the signals and keeps the clock is
 * lib/connectionStatus.ts.
 */

export type ConnectionState = "online" | "degraded" | "offline" | "catching-up";

/** Everything the machine looks at, sampled at one instant. */
export interface ConnectionSignals {
  /** The browser's own word on its link; false only when it knows there is none. */
  browserOnline: boolean;
  /** Whether nothing has answered since a call went out unanswered; see lib/reachability.ts. */
  unreachable: boolean;
  /** lib/degraded.ts's verdict. */
  degraded: boolean;
  /** API calls under way. */
  inFlight: number;
  /** Whether the radar frames held have been overtaken by the clock; see lib/freshness.ts. */
  stale: boolean;
}

/** Where the machine is, and since when, ms. */
export interface Connection {
  state: ConnectionState;
  since: number;
}

export const INITIAL_CONNECTION: Connection = { state: "online", since: 0 };

/**
 * The least time catching up is shown for.
 *
 * Long enough to be read rather than flash, and for the refetch a recovery
 * sets off to have started: the endpoint that answered is marked healthy a
 * moment before the wake that refetches the rest goes out, and judged in that
 * moment, nothing is in flight yet.
 */
export const CATCH_UP_MIN_MS = 1500;

/**
 * The most. A refetch that has not settled by then is not catching up any
 * more but slow, and whether that is degraded is lib/degraded.ts's question.
 * Also what keeps a call that never settles from holding the state for good.
 */
export const CATCH_UP_MAX_MS = 30_000;

/** The next state, given the signals at `now`. Hands back `current` itself when nothing changed. */
export function nextConnection(current: Connection, signals: ConnectionSignals, now: number): Connection {
  const to = (state: ConnectionState): Connection => (
    state === current.state ? current : { state, since: now }
  );
  if (!signals.browserOnline || signals.unreachable) return to("offline");
  switch (current.state) {
    case "offline":
      return to("catching-up");
    case "degraded":
      return signals.degraded ? current : to("catching-up");
    case "catching-up": {
      const held = now - current.since;
      const settled = signals.inFlight === 0 && !signals.stale;
      if (held < CATCH_UP_MIN_MS || (!settled && held < CATCH_UP_MAX_MS)) return current;
      return to(signals.degraded ? "degraded" : "online");
    }
    case "online":
    default:
      return signals.degraded ? to("degraded") : current;
  }
}

/**
 * When the machine next has to be asked again with nothing else changing, ms;
 * null when only a change in the signals can move it. Only catching up waits
 * on the clock alone.
 */
export function nextDeadline(current: Connection, now: number): number | null {
  if (current.state !== "catching-up") return null;
  const min = current.since + CATCH_UP_MIN_MS;
  return now < min ? min : current.since + CATCH_UP_MAX_MS;
}
