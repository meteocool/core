import { networkStatus, type NetworkStatus } from "../stores";

/** The subset of NetworkInformation this reads. */
interface Connection extends EventTarget {
  effectiveType?: string;
  downlink?: number;
}

const SLOW_TYPES = new Set(["slow-2g", "2g", "3g"]);

/** Below this, in Mbit/s, a connection counts as slow whatever it calls itself. */
const SLOW_DOWNLINK_MBPS = 1.5;

function getConnection(): Connection | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: Connection;
    mozConnection?: Connection;
    webkitConnection?: Connection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function read(): NetworkStatus {
  if (typeof navigator === "undefined") {
    return { online: true, effectiveType: null, isSlow: false };
  }
  const connection = getConnection();
  const effectiveType = connection?.effectiveType ?? null;
  const downlink = connection?.downlink;
  return {
    online: navigator.onLine,
    effectiveType,
    isSlow:
      (effectiveType !== null && SLOW_TYPES.has(effectiveType))
      || (typeof downlink === "number" && downlink > 0 && downlink < SLOW_DOWNLINK_MBPS),
  };
}

/** Re-read the connection and publish it. */
export function refreshNetworkStatus() {
  networkStatus.set(read());
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

  const connection = getConnection();
  if (connection) {
    connection.addEventListener("change", onChange);
    teardown.push(() => connection.removeEventListener("change", onChange));
  }
}

export function cleanupNetworkStatus() {
  teardown.forEach((off) => off());
  teardown = [];
}
