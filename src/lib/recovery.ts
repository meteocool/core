import { apiHealth } from "../stores";
import { wake } from "./wakeup";

/**
 * Coming back for what a flaky network took away.
 *
 * A call that fails for the network's sake is retried twice on the spot (see
 * RETRY_DELAYS_MS in api/index.ts), and after that it fails: the radar grid,
 * the lightning backfill, the cells in view all stay whatever they were, and
 * nothing asked for them again until the next socket poke (which a socket on
 * the same bad network may never deliver) or until the page was
 * hidden and shown again. A map that loaded while a train was in a tunnel sat
 * there without radar, and "Degraded", for as long as the reader looked at it.
 *
 * So a failure that outlives its retries leaves a probe behind: the same
 * request, sent again on its own (no loading bar, no retries) every
 * PROBE_MS while it keeps failing. One probe at a time, taking the failing
 * endpoints in turn, so a backend that is down is asked one small question
 * every ten seconds per reader rather than all of them. The first answer
 * means the network is back: that endpoint is marked healthy, and the page
 * resyncs the way a return to it does (lib/wakeup.ts), which refetches the
 * rest. An endpoint the resync does not cover goes on being probed until it
 * answers. Nothing is probed once nothing is failing.
 *
 * That puts the map back within PROBE_MS and the stall timeout of the
 * network returning: under thirty seconds even when the probe out at that
 * moment was one sent into the stall.
 *
 * The other signs that the network is back (the browser's `online`, the
 * socket reconnecting) resync on their own, and do not wait for this.
 */

/** From a failure to the first probe: long enough for a blip to have passed. */
export const FIRST_PROBE_MS = 5_000;

/** Between one probe settling and the next. */
export const PROBE_MS = 10_000;

/** Asks for an endpoint once more; true when it answered. */
export type Probe = () => Promise<boolean>;

/** The endpoints whose last call failed for the network's sake, each with its probe. */
const probes = new Map<string, Probe>();

let timer: ReturnType<typeof setTimeout> | null = null;
let probing = false;
let unsubscribe: (() => void) | null = null;

function schedule(delay: number) {
  if (timer !== null || probing || !probes.size) return;
  timer = setTimeout(() => {
    timer = null;
    void probe();
  }, delay);
}

async function probe() {
  const next = probes.entries().next().value;
  if (!next) return;
  const [id, ask] = next;
  // A hidden page asks nothing: coming back to it resyncs anyway.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    schedule(PROBE_MS);
    return;
  }
  probing = true;
  const answered = await ask().catch(() => false);
  probing = false;
  if (answered) {
    probes.delete(id);
    wake(`${id} answers again`);
  } else if (probes.get(id) === ask) {
    // To the back of the line, so every failing endpoint gets its turn.
    probes.delete(id);
    probes.set(id, ask);
  }
  schedule(PROBE_MS);
}

/** A call failed for the network's sake, its retries spent: probe it until it answers. */
export function noteTransientFailure(id: string, ask: Probe): void {
  probes.set(id, ask);
  schedule(FIRST_PROBE_MS);
}

/**
 * Start watching for endpoints that recover some other way (a poke, a
 * resync) and stop probing them. Idempotent, like the other init
 * functions: the entrypoints and a hot reload both reach it.
 */
export function initRecovery(): void {
  cleanupRecovery();
  unsubscribe = apiHealth.subscribe((health) => {
    for (const id of [...probes.keys()]) {
      if (!health.failing.includes(id)) probes.delete(id);
    }
    if (!probes.size && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

export function cleanupRecovery(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  probing = false;
  probes.clear();
}
