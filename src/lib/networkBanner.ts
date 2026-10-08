import type { NetworkStatus } from "../stores";

/**
 * Whether the connection banner should be showing.
 *
 * Only the connection counts, never tile errors: a single tile 404 at the edge
 * of the radar extent is normal, and showing "connection issue" for it trains
 * people to ignore the banner.
 */
export function shouldShowNetworkBanner(net: NetworkStatus | null | undefined): boolean {
  if (!net) return false;
  return net.online === false || net.isSlow === true;
}
