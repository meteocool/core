/**
 * How the flat map's "3D" tag looks for a storm a scan behind its radar.
 *
 * The radar moves on a few minutes before that scan's volumes are built (see
 * lib/scans.ts). Taking the tags off for those minutes made them blink out
 * with every scan; left on in full colour, they would claim the storm is
 * where the new radar shows it. So they stay, greyed, until the new scan's
 * volumes land: a grey laid over the cube's colour, with a little of the
 * colour still showing through, so a strong core is still told from a weak
 * one at a glance.
 */

type Rgb = [number, number, number];

/** How much of the cube's own colour shows through the grey. */
export const STALE_COLOUR_KEPT = 0.15;

/** `colour` under `grey`, keeping `STALE_COLOUR_KEPT` of it. */
export function greyedOut(colour: Rgb, grey: Rgb): Rgb {
  return colour.map((channel, i) => Math.round(
    grey[i] * (1 - STALE_COLOUR_KEPT) + channel * STALE_COLOUR_KEPT,
  )) as Rgb;
}

/**
 * Which of two tags gives way when they crowd each other: a current one
 * before a stale one, then the stronger core. Negative when `a` wins.
 */
export function tagPrecedence(
  a: { stale: boolean; peak: number },
  b: { stale: boolean; peak: number },
): number {
  if (a.stale !== b.stale) return a.stale ? 1 : -1;
  return b.peak - a.peak;
}
