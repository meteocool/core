/**
 * How a storm a scan behind its radar is drawn: the flat map's "3D" tag, and
 * the 3D map's box outline on the ground.
 *
 * The radar moves on a few minutes before that scan's volumes are built (see
 * lib/scans.ts). Taking the tags off for those minutes made them blink out
 * with every scan; left on in full colour, they would claim the storm is
 * where the new radar shows it. So they stay, greyed, until the new scan's
 * volumes land: a grey laid over the cube's colour, with a little of the
 * colour still showing through, so a strong core is still told from a weak
 * one at a glance.
 */

export type Rgb = [number, number, number];

/** How much of the cube's own colour shows through the grey. */
export const STALE_COLOUR_KEPT = 0.15;

/**
 * The grey laid over a stale storm's colour, by the brightness of the map it
 * is on: the flat map's tags, and the 3D map's box outlines on the ground.
 */
export const STALE_GREY: Record<"light" | "dark", Rgb> = { light: [158, 162, 168], dark: [112, 117, 125] };

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
