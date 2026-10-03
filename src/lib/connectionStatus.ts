import { derived, get, type Readable } from "svelte/store";
import {
  connectionStatus, degradedStatus, networkStatus, radarStale, reachability,
} from "../stores";
import { nextConnection, nextDeadline, type ConnectionSignals } from "./connectionState";

/**
 * Running the connection's state machine, lib/connectionState.ts.
 *
 * Split from it the way degradedStatus.ts is split from degraded.ts: this
 * samples the signals and keeps the clock, the machine is a pure function of
 * what this hands it.
 *
 * Every signal is a store, so the machine is stepped whenever one of them
 * moves. Catching up also ends on the clock alone, so while it holds, a timer
 * steps it again at its next deadline.
 */

const signals: Readable<ConnectionSignals> = derived(
  [networkStatus, reachability, degradedStatus, radarStale],
  ([network, reach, degraded, stale]) => ({
    browserOnline: network.online,
    unreachable: reach.unreachableSince !== null,
    degraded: degraded.degraded,
    inFlight: reach.inFlight,
    stale,
  }),
);

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

/** Step the machine on the signals as they are now. */
export function refreshConnectionStatus(): void {
  const now = Date.now();
  const current = get(connectionStatus);
  const next = nextConnection(current, get(signals), now);
  if (next !== current) {
    console.log(`Connection: ${current.state} -> ${next.state}`);
    connectionStatus.set(next);
  }
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const deadline = nextDeadline(next, now);
  if (deadline !== null && typeof window !== "undefined") {
    timer = setTimeout(refreshConnectionStatus, Math.max(0, deadline - now));
  }
}

/** Start running it. Idempotent, like the other init functions. */
export function initConnectionStatus(): void {
  cleanupConnectionStatus();
  // Called at once with the signals as they are, which is the first step.
  unsubscribe = signals.subscribe(() => refreshConnectionStatus());
}

export function cleanupConnectionStatus(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
