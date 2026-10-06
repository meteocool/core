/**
 * Capabilities that are built but not currently offered.
 *
 * The code, layers and scale lines stay in the tree and keep type-checking --
 * this is the only thing standing between them and the UI, so re-enabling one
 * is deleting a line here rather than reconstructing it from a commented-out
 * block that has since rotted.
 *
 * - `satellite` and `aerosols` both read tiles from tiles{2,3}.ororatech.com,
 *   an endpoint outside meteocool's own infrastructure.
 */
export const DISABLED_CAPABILITIES: ReadonlySet<string> = new Set(["satellite", "aerosols"]);

export function capabilityEnabled(name: string): boolean {
  return !DISABLED_CAPABILITIES.has(name);
}
