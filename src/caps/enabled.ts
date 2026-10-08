/**
 * Capabilities that are built but not currently offered.
 *
 * The code, layers and scale lines stay in the tree and keep type-checking.
 * This set is all that keeps them out of the UI, so re-enabling one means
 * deleting a line here instead of reconstructing it from a commented-out
 * block that has since rotted. None is withdrawn at the moment: the satellite
 * and aerosol maps, the last two, were removed outright.
 */
export const DISABLED_CAPABILITIES: ReadonlySet<string> = new Set();

export function capabilityEnabled(name: string): boolean {
  return !DISABLED_CAPABILITIES.has(name);
}
