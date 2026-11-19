/**
 * Studio's camera: the standard views, and the lenses.
 *
 * The 3D map's own camera is a hand on the map: drag, turn, tilt. That finds
 * a view, and it cannot find the same one twice, or one square to anything.
 * These are the views a drawing has: from above, from each side, and the
 * three-quarter view between them, each by name.
 *
 * The lens is the field of view. MapLibre keeps what the camera looks at the
 * same size as the lens changes, by standing nearer or further back, so a
 * long lens is the same picture with its perspective pressed flat: far
 * storms as tall as near ones, uprights upright. That is as near to a
 * drawing's parallel projection as a camera gets, and it is what the
 * elevations want.
 */
import { DEFAULT_FOV } from "./scene";
import type { StudioCamera } from "./scene";

/** How low the side views look from: almost along the ground, with the ground still a surface. */
const ELEVATION_PITCH = 84;
/** The three-quarter view's tilt, which is the one the 3D map opens at. */
const ISO_PITCH = 55;

export const VIEWS = ["top", "north", "east", "south", "west", "iso"] as const;
export type ViewName = typeof VIEWS[number];

/**
 * Where each view puts the camera. A side view is named for where it looks
 * from, as an elevation is: the south view stands south of the storm and
 * looks north.
 */
export function viewCamera(view: ViewName, bearing: number): Pick<StudioCamera, "pitch" | "bearing"> {
  switch (view) {
    case "top": return { pitch: 0, bearing: 0 };
    case "south": return { pitch: ELEVATION_PITCH, bearing: 0 };
    case "west": return { pitch: ELEVATION_PITCH, bearing: 90 };
    case "north": return { pitch: ELEVATION_PITCH, bearing: 180 };
    case "east": return { pitch: ELEVATION_PITCH, bearing: 270 };
    // From the nearest corner to where the camera already is, so it turns no further than it must.
    default: return { pitch: ISO_PITCH, bearing: (Math.round((bearing - 45) / 90) * 90 + 45 + 360) % 360 };
  }
}

export const LENSES = ["wide", "normal", "long", "flat"] as const;
export type LensName = typeof LENSES[number];

/** Each lens's field of view, in degrees. */
export const LENS_FOV: Record<LensName, number> = { wide: 60, normal: DEFAULT_FOV, long: 16, flat: 5 };

/** The lens a field of view is, or null between two of them. */
export function lensOf(fov: number): LensName | null {
  return LENSES.find((lens) => Math.abs(LENS_FOV[lens] - fov) < 0.5) ?? null;
}
