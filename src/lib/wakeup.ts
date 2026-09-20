/**
 * Noticing that the page has come back after not running.
 *
 * Everything in the app that keeps itself current -- the grid refresh, the
 * "last updated" tick, socket.io's own reconnect backoff -- is a timer, and a
 * suspended tab's timers do not run. A phone that has been in a pocket for
 * twenty minutes comes back to a map drawn from frames that expired nineteen
 * minutes ago, with nothing scheduled to notice: the poke that would have
 * refreshed it was sent to a socket that was not listening, and the next one is
 * up to a publish cycle away.
 *
 * The native apps have always called window.enterForeground() for this. The web
 * had the same hook and nothing wired to it, so the browser -- which is where
 * most of the backgrounding happens -- was the one case that never resynced.
 *
 * No single browser signal covers it. visibilitychange is the main one but does
 * not fire for every lock-screen transition on iOS; a bfcache restore fires only
 * pageshow; a tab that was throttled rather than hidden fires nothing at all. So
 * all of them are listened to, plus a watchdog that catches the general case by
 * noticing that more wall clock time has passed than our own timer accounts for,
 * and the resulting burst is collapsed into one wake.
 */

export type WakeListener = (reason: string) => void;

/**
 * How long after a wake another signal is treated as the same one.
 *
 * Coming back to a tab can fire visibilitychange, focus and the watchdog within
 * a few milliseconds of each other, and each one would otherwise start its own
 * round of refetches.
 */
export const WAKE_DEBOUNCE_MS = 1000;

/** How often the watchdog checks the clock against itself. */
export const WATCHDOG_INTERVAL_MS = 5000;

/**
 * A gap this much beyond the watchdog interval counts as not having run.
 *
 * Well above the drift of a timer on a busy main thread, well below anything
 * that matters to the map.
 */
export const CLOCK_JUMP_MS = 20_000;

const listeners = new Set<WakeListener>();
let lastWakeAt = 0;
let teardown: Array<() => void> = [];

/** Register interest in waking. Returns the unsubscribe, like a store does. */
export function onWake(listener: WakeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce a wake, unless one was just announced.
 *
 * Exported because the native bridge is one of the signals: the apps route
 * window.enterForeground() through here so a native foreground and a browser
 * visibilitychange arriving together still only resync once.
 */
export function wake(reason: string) {
  const now = Date.now();
  if (now - lastWakeAt < WAKE_DEBOUNCE_MS) return;
  lastWakeAt = now;
  console.log(`Foreground: ${reason}`);
  listeners.forEach((listener) => listener(reason));
}

/**
 * Start watching. Idempotent, like initNetworkStatus(): the entrypoints and a
 * hot reload can both reach it, and a second watchdog would be invisible.
 */
export function initWakeup() {
  cleanupWakeup();
  if (typeof window === "undefined") return;

  const onVisibility = () => {
    if (document.visibilityState === "visible") wake("visibilitychange");
    // Pausing playback on the way out is the app's business, not ours; it is on
    // window because that is where the iOS host calls it from.
    else window.leaveForeground?.();
  };
  document.addEventListener("visibilitychange", onVisibility);
  teardown.push(() => document.removeEventListener("visibilitychange", onVisibility));

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) wake("bfcache restore");
  };
  window.addEventListener("pageshow", onPageShow);
  teardown.push(() => window.removeEventListener("pageshow", onPageShow));

  const onFocus = () => wake("focus");
  window.addEventListener("focus", onFocus);
  teardown.push(() => window.removeEventListener("focus", onFocus));

  const onOnline = () => wake("back online");
  window.addEventListener("online", onOnline);
  teardown.push(() => window.removeEventListener("online", onOnline));

  let expectedAt = Date.now() + WATCHDOG_INTERVAL_MS;
  const watchdog = window.setInterval(() => {
    const now = Date.now();
    const drift = now - expectedAt;
    expectedAt = now + WATCHDOG_INTERVAL_MS;
    if (drift > CLOCK_JUMP_MS) wake(`clock jumped ${Math.round(drift / 1000)}s`);
  }, WATCHDOG_INTERVAL_MS);
  teardown.push(() => window.clearInterval(watchdog));
}

export function cleanupWakeup() {
  teardown.forEach((off) => off());
  teardown = [];
}
