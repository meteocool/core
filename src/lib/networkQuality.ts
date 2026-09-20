import type { NetworkStatus } from "../stores";

/**
 * Reading the connection, with no store and no browser globals of its own, so
 * it can be exercised directly -- same arrangement as networkBanner.ts. The
 * wiring that publishes this lives in networkStatus.ts.
 */

/** The subset of NetworkInformation this reads. */
export interface Connection {
  effectiveType?: string;
  saveData?: boolean;
}

/** Just enough of Navigator to read, so tests can pass a stub instead. */
export interface NavigatorLike {
  onLine?: boolean;
  connection?: Connection;
  mozConnection?: Connection;
  webkitConnection?: Connection;
}

/**
 * The effective types worth warning about.
 *
 * Deliberately not "3g". effectiveType is a coarse bucket driven mostly by
 * round-trip time, and anything past roughly 270ms lands in 3g: an ordinary
 * mobile connection, a VPN, a dev server proxying to a remote backend. Warning
 * on it meant the banner was up permanently, which teaches people to ignore it.
 * slow-2g and 2g are the buckets that actually mean degraded.
 *
 * `downlink` used to be tested here too, below 1.5 Mbit/s. That reads what the
 * page recently *used*, not what is available -- it is a smoothed estimate over
 * observed transfers, rounded to 25 kbps and capped at 10 -- so an app that
 * fetches small JSON and cached tiles measures as slow on a gigabit line. It is
 * replaced by saveData, which is the user saying so rather than us guessing.
 */
const SLOW_TYPES = new Set(["slow-2g", "2g"]);

export function getConnection(nav: NavigatorLike | undefined): Connection | undefined {
  if (!nav) return undefined;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/** The connection as it reads right now, before any settling. */
export function readNetworkStatus(nav: NavigatorLike | undefined): NetworkStatus {
  if (!nav) {
    return { online: true, effectiveType: null, isSlow: false };
  }
  const connection = getConnection(nav);
  const effectiveType = connection?.effectiveType ?? null;
  return {
    online: nav.onLine !== false,
    effectiveType,
    isSlow:
      (effectiveType !== null && SLOW_TYPES.has(effectiveType))
      || connection?.saveData === true,
  };
}
