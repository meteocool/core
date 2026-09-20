import { networkStatus } from "../stores";
import {
  getConnection, readNetworkStatus, type Connection, type NavigatorLike,
} from "./networkQuality";

/**
 * How long a slow reading has to hold before the banner appears.
 *
 * The first estimates after a cold load are made from a handful of requests and
 * swing about; without this the banner flashes on almost every page load.
 * Offline is not debounced -- that reading is not an estimate.
 */
export const SLOW_SETTLE_MS = 5000;

const currentNavigator = (): NavigatorLike | undefined => (
  typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike)
);

/** What was last published, so a slow reading knows whether it is new. */
let publishedSlow = false;
let settleTimer: number | undefined;

function clearSettleTimer() {
  if (settleTimer !== undefined) {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
  }
}

/**
 * Re-read the connection and publish it.
 *
 * A reading that is no longer slow takes effect at once; one that has just
 * turned slow has to still be slow SLOW_SETTLE_MS later.
 */
export function refreshNetworkStatus() {
  const reading = readNetworkStatus(currentNavigator());

  if (!reading.isSlow) {
    clearSettleTimer();
    publishedSlow = false;
    networkStatus.set(reading);
    return;
  }

  if (publishedSlow) {
    networkStatus.set(reading);
    return;
  }

  // Slow, but not yet vouched for: publish everything else about the reading
  // and let the timer decide.
  networkStatus.set({ ...reading, isSlow: false });
  if (settleTimer !== undefined || typeof window === "undefined") return;
  settleTimer = window.setTimeout(() => {
    settleTimer = undefined;
    const settled = readNetworkStatus(currentNavigator());
    if (!settled.isSlow) return;
    publishedSlow = true;
    networkStatus.set(settled);
  }, SLOW_SETTLE_MS);
}

let teardown: Array<() => void> = [];

/**
 * Start tracking connectivity. Idempotent: calling it twice does not stack
 * listeners, because the entrypoints and a hot reload can both reach it.
 */
export function initNetworkStatus() {
  cleanupNetworkStatus();
  if (typeof window === "undefined") return;

  refreshNetworkStatus();

  const onChange = () => refreshNetworkStatus();
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  teardown.push(() => window.removeEventListener("online", onChange));
  teardown.push(() => window.removeEventListener("offline", onChange));

  const connection = getConnection(currentNavigator()) as (Connection & EventTarget) | undefined;
  if (connection?.addEventListener) {
    connection.addEventListener("change", onChange);
    teardown.push(() => connection.removeEventListener("change", onChange));
  }
}

export function cleanupNetworkStatus() {
  teardown.forEach((off) => off());
  teardown = [];
  clearSettleTimer();
  publishedSlow = false;
}
