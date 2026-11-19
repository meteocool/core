/**
 * How the 3D map draws a storm's volume: the same field, five pictures of it.
 *
 * - `cloud`: a lit, soft cloud of everything from light rain up. What a storm
 *   looks like from outside; its core shows once it peels or is cut.
 * - `glow`: the field as light, unlit and see-through, from the faintest
 *   echo up. Every reflectivity keeps its own colour, and the stronger it
 *   is the more light it gives off, so the core shines through the veil of
 *   weak echo around it.
 * - `shells`: a solid surface at every tenth dBZ, nested like an onion, each
 *   in its level's colour. Where the storm crosses a threshold is exact, and
 *   what is inside one shows once it peels or is cut. Only in Studio: a
 *   storm left whole is its outermost shell and nothing else, and it takes
 *   a section plane through it for the nesting to read.
 * - `sky`: the storm as a cloud, the way a satellite or an aircraft sees one:
 *   white where the sun is on it, grey in its own shadow, no palette. Cut, it
 *   shows the radar's colours inside.
 * - `tinted`: the same white cloud, its hull tinted by the strongest echo
 *   aloft in the column beneath each point of it (`HULL_TINT`): where the
 *   storm is strong reads from outside without the cloud ceasing to be one.
 *
 * Kept apart from the layer, which needs a GL context, so the settings, the
 * links and the tests can name a style without it.
 */
/**
 * Every style, in the order Studio offers them. A Studio scene link stores a
 * style as its place in this list, so a new one goes at the end and none is
 * ever moved.
 */
export const CLOUD_STYLES = ["cloud", "glow", "shells", "sky", "tinted"] as const;
export type CloudStyle = typeof CLOUD_STYLES[number];

export const DEFAULT_CLOUD_STYLE: CloudStyle = "cloud";

/**
 * The styles the 3D map offers outside Studio, in the order its menus list
 * them: every one but `shells`, which says nothing until it is cut.
 */
export const MAP_STYLES: readonly CloudStyle[] = ["cloud", "sky", "tinted", "glow"];

/** The style a Studio scene or a link names; the default for anything else. */
export function cloudStyleOf(value: unknown): CloudStyle {
  return (CLOUD_STYLES as readonly unknown[]).includes(value) ? value as CloudStyle : DEFAULT_CLOUD_STYLE;
}

/** Whether the map offers this style outside Studio. */
export const isMapStyle = (value: unknown): value is CloudStyle => (MAP_STYLES as readonly unknown[]).includes(value);

/**
 * The style the map draws for a stored setting or a link outside Studio: the
 * one named if the map offers it, the default for anything else, a Studio
 * style among them.
 */
export function mapStyleOf(value: unknown): CloudStyle {
  return isMapStyle(value) ? value : DEFAULT_CLOUD_STYLE;
}

/** The surfaces `shells` draws, in dBZ: one every `SHELL_STEP`, up to `SHELL_TOP`. */
export const SHELL_STEP = 10;
export const SHELL_TOP = 60;

/**
 * What each style draws of the field.
 *
 * `floor` is the weakest echo it shows, in dBZ, and where its peel starts
 * from. `band` is how many dBZ above that the echo takes to reach its full
 * opacity (nothing to `shells`, whose surfaces are where they are).
 */
export const STYLE_FIELD: Record<CloudStyle, { floor: number; band: number }> = {
  cloud: { floor: 20, band: 14 },
  glow: { floor: 5, band: 45 },
  shells: { floor: 10, band: 0 },
  // A little fuller than `cloud`, as a real cloud stands outside the rain a
  // radar sees in it. No fuller: a storm's tiles hold its echo from about
  // here up, and the rain shield below it, cut off at the last tile, stood
  // as a wall of cloud along the storm's edge.
  sky: { floor: 17, band: 13 },
  tinted: { floor: 17, band: 13 },
};

/**
 * How `tinted` colours a cloud's hull by the strongest echo aloft in the
 * column under it (from `aloftKm` up): not at all up to `from` dBZ, rising
 * to `strength` of the palette's colour at `full`, the rest the cloud's own
 * white and shade.
 *
 * Reflectivity rather than an echo top: the hull's shape already says how
 * tall a storm is, and what a white hull hides is how strong it is inside.
 * It is also what the palette is made for, so a colour on the hull means what
 * it means on the radar beneath. Aloft rather than the whole column: the
 * melting snow of a wide rain shield is a band of 35 to 45 dBZ a couple of
 * kilometres up, which tinted all of it as strong as a storm, while only a
 * storm's updraft carries an echo that strong above the freezing level.
 * Weak echo stays white, so a tint is a storm and not every shower; never
 * all the way to the palette, so the sun and the shadows still model the
 * cloud through it.
 */
export const HULL_TINT = { aloftKm: 4, from: 32, full: 55, strength: 0.62 } as const;

/** How much of the palette's colour `tinted` lays on a hull over this echo aloft, 0 to `strength`. */
export function hullTint(dbz: number): number {
  const t = Math.min(Math.max((dbz - HULL_TINT.from) / (HULL_TINT.full - HULL_TINT.from), 0), 1);
  return HULL_TINT.strength * t * t * (3 - 2 * t);
}

/**
 * The surfaces `shells` draws once peeled to `low`, outermost first: one at
 * `low` itself, so the outermost shrinks as the peel runs rather than
 * popping off, then every level above it.
 */
export function shellLevels(low: number): number[] {
  const levels = [low];
  for (let level = SHELL_STEP; level <= SHELL_TOP; level += SHELL_STEP) {
    if (level > low) levels.push(level);
  }
  return levels;
}
