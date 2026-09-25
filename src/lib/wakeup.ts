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

/**
 * How long the page has to have been hidden before coming back counts as a
 * wake worth resyncing for.
 *
 * Below this nothing has expired: the radar publishes every five minutes and
 * the socket is still up, so a resync would refetch every endpoint to learn
 * nothing. Alt-tabbing between windows used to do exactly that, eight
 * requests a time, and so did the page's own first paint -- the browser fires
 * visibilitychange as it comes up, and that was read as a return from
 * somewhere.
 */
export const MIN_HIDDEN_MS = 60_000;

const listeners = new Set<WakeListener>();
let lastWakeAt = 0;
let teardown: Array<() => void> = [];
/** When the page was last hidden, or null while it is showing. */
let hiddenAt: number | null = null;
/** Work put off while the page was hidden, by key so a repeat replaces rather than stacks. */
const deferred = new Map<string, () => void>();

/**
 * Run `work` now if the page is showing, otherwise once it shows again.
 *
 * For the socket's nudges. Each one is a fetch -- the radar grid, the cells
 * in view, a network's frame -- that a hidden tab has no use for until it is
 * looked at, by which time several have usually arrived and only the newest
 * matters: keyed, so the last poke of a kind is the one that runs. This is
 * separate from `wake`, which is gated on how long the page was away; a poke
 * deferred for ten seconds still has to land when the page comes back.
 */
export function whenVisible(key: string, work: () => void): void {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    work();
    return;
  }
  deferred.set(key, work);
}

function runDeferred() {
  const pending = [...deferred.values()];
  deferred.clear();
  pending.forEach((work) => work());
}

/** How long the page was hidden, in ms, or 0 while it has not been. */
function hiddenFor(): number {
  return hiddenAt === null ? 0 : Date.now() - hiddenAt;
}

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
  // A wake nobody is looking at -- the watchdog noticing a throttled tab's
  // clock jump, the network coming back to a hidden page -- is put off like a
  // poke. It runs, once, when the page shows again.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    deferred.set("wake", () => wake(reason));
    return;
  }
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

  /* Only a return from a real absence is a wake; see MIN_HIDDEN_MS. The
     deferred pokes run on any return, however short -- they were put off, not
     judged unnecessary. */
  const back = (reason: string) => {
    const away = hiddenFor();
    hiddenAt = null;
    runDeferred();
    if (away >= MIN_HIDDEN_MS) wake(`${reason} after ${Math.round(away / 1000)}s`);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      back("visibilitychange");
      return;
    }
    hiddenAt ??= Date.now();
    // Pausing playback on the way out is the app's business, not ours; it is on
    // window because that is where the iOS host calls it from.
    window.leaveForeground?.();
  };
  document.addEventListener("visibilitychange", onVisibility);
  teardown.push(() => document.removeEventListener("visibilitychange", onVisibility));

  // A bfcache restore is a page that was put away whole; its timers and socket
  // have been frozen for however long, and the page itself cannot tell.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) wake("bfcache restore");
  };
  window.addEventListener("pageshow", onPageShow);
  teardown.push(() => window.removeEventListener("pageshow", onPageShow));

  const onFocus = () => back("focus");
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
  hiddenAt = null;
  deferred.clear();
}
