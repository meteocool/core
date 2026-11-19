/**
 * How the 3D map draws a storm's volume: the same field, three pictures of it.
 *
 * - `cloud`: a lit, soft cloud of everything from light rain up. What a storm
 *   looks like from outside; its core shows once it peels or is cut.
 * - `glow`: the field as light, unlit and see-through, from the faintest
 *   echo up. Every reflectivity keeps its own colour, so the core shows
 *   through the envelope around it.
 * - `shells`: a solid surface at every tenth dBZ, nested like an onion, each
 *   in its level's colour. Where the storm crosses a threshold is exact, and
 *   what is inside one shows once it peels or is cut.
 *
 * Kept apart from the layer, which needs a GL context, so the settings, the
 * links and the tests can name a style without it.
 */
export const CLOUD_STYLES = ["cloud", "glow", "shells"] as const;
export type CloudStyle = typeof CLOUD_STYLES[number];

export const DEFAULT_CLOUD_STYLE: CloudStyle = "cloud";

/** The style a stored setting or a link names; the default for anything else. */
export function cloudStyleOf(value: unknown): CloudStyle {
  return (CLOUD_STYLES as readonly unknown[]).includes(value) ? value as CloudStyle : DEFAULT_CLOUD_STYLE;
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
};

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
