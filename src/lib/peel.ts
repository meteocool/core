/**
 * The 3D map's peel: how far each storm is thinned towards its core.
 *
 * A storm drawn whole is its envelope: light rain all round, with the core
 * that matters hidden inside it. Peeled, the weakest echo is left out, shell
 * by shell, until only the core stands. How far is one number, 0 whole to 1
 * down to the core, and it means something different for every storm: each
 * is thinned between the faintest echo its style draws and the reflectivity
 * only its own core reaches. So one level leaves a large storm showing from
 * its moderate rain up, and leaves a field of faint showers, which have no
 * core to speak of, as it is.
 *
 * The storms once peeled back and forth on their own to show this. They now
 * stand still at a level of their style's choosing, until the reader moves
 * the slider.
 */

/**
 * Where each style's peel stands before the reader touches it.
 *
 * The lit cloud is opaque from light rain up, so whole it shows nothing of
 * what is inside: it starts most of the way to the core, which on a strong
 * storm is where the palette turns from green to yellow, and on weak rain is
 * no peel at all. Every other style either shows its inside already or is
 * drawn for its outside, and starts whole.
 */
const DEFAULT_PEELS: Record<string, number> = { cloud: 0.6 };

/** The peel a style starts at; see `DEFAULT_PEELS`. */
export const defaultPeel = (style: string): number => DEFAULT_PEELS[style] ?? 0;

/**
 * The camera zooms, MapLibre's own, between which the default peel comes
 * in: none below the first, all of it from the second.
 *
 * Zoomed out, a storm is a few dozen pixels of soft cloud. Thinned to its
 * core there it is a speck, and the map of a region loses its weather; drawn
 * whole it reads as where it rains. One measure for the whole map, not one
 * per storm on screen: tiles of one storm peeled to different depths show
 * the seam between them.
 */
export const PEEL_ZOOMS: [number, number] = [6, 7.5];

/**
 * How much of the peel is drawn at a zoom, 0 to 1. A level the reader set
 * themself is drawn in full wherever they look at it from.
 */
export function peelShare(zoom: number, own: boolean): number {
  if (own) return 1;
  const t = Math.min(Math.max((zoom - PEEL_ZOOMS[0]) / (PEEL_ZOOMS[1] - PEEL_ZOOMS[0]), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The weakest echo a storm shows at a peel, in dBZ: from the faintest its
 * style draws to what only its core reaches. A storm whose core is no
 * stronger than that floor does not peel.
 */
export function peelLow(floor: number, core: number, peel: number): number {
  return floor + Math.max(core - floor, 0) * Math.min(Math.max(peel, 0), 1);
}
