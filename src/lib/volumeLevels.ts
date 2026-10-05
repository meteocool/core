/**
 * Which volumes the 3D map draws at the zoom it is at.
 *
 * Every run builds, over its tiles, the coarse zoom-9 tile each lies in, at
 * about 1 km a voxel: four times a tile's ground for a quarter of its
 * texture. Zoomed out, the map draws those in place of the tiles in them, so
 * a whole outbreak fits the textures a few dozen tiles would take, and the
 * voxels it skips are finer than the screen at that zoom anyway. Zoomed in,
 * it draws the tiles. Never both over the same ground.
 */
import type { RadarVolume } from "../api";

/** The zoom the worker builds coarse tiles at (`voxels.COARSE_ZOOM`). */
export const COARSE_ZOOM = 9;

/** The coarse tile a tile lies in, as `x/y` at `COARSE_ZOOM`. */
function coarseKey(tile: readonly number[]): string | null {
  const [z, x, y] = tile;
  const shift = z - COARSE_ZOOM;
  return shift >= 0 ? `${x >> shift}/${y >> shift}` : null;
}

/**
 * The volumes to draw, zoomed out (`coarse`) or in.
 *
 * Zoomed out, each coarse tile stands in for the tiles in it, and a tile whose
 * coarse tile was not built -- the run was cut short before it -- is drawn
 * itself. Zoomed in, the tiles alone. A volume from before tiles is drawn
 * either way. The open volume is always drawn, and the coarse tile over it is
 * not: an open storm keeps its own picture while the reader zooms out.
 */
export function atLevel(clouds: readonly RadarVolume[], coarse: boolean, openPath: string | null = null): RadarVolume[] {
  const fine = clouds.filter((cloud) => !cloud.coarse);
  if (!coarse) return fine;
  const open = openPath ? clouds.find((cloud) => cloud.path === openPath && !cloud.coarse) : undefined;
  const openKey = open?.tile ? coarseKey(open.tile) : null;
  const parents = clouds.filter((cloud) => cloud.coarse && cloud.tile && coarseKey(cloud.tile) !== openKey);
  const covered = new Set(parents.map((cloud) => coarseKey(cloud.tile!)));
  return [
    ...parents,
    ...fine.filter((cloud) => !cloud.tile || !covered.has(coarseKey(cloud.tile)) || cloud.path === openPath),
  ];
}

/** The column and row of the zoom-`z` tile a point stands in, as the map numbers them. */
function tileAt(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [Math.min(Math.max(x, 0), n - 1), Math.min(Math.max(y, 0), n - 1)];
}

/**
 * The finest listed tile, not a coarse one, that a point stands in: what a
 * tap on a coarse tile opens, since a coarse tile's 1 km voxels are no
 * picture to cut a storm open by.
 */
export function fineAt(clouds: readonly RadarVolume[], lon: number, lat: number): RadarVolume | null {
  for (const z of [11, 10]) {
    const [x, y] = tileAt(lon, lat, z);
    const found = clouds.find((cloud) => !cloud.coarse && cloud.tile?.[0] === z && cloud.tile[1] === x && cloud.tile[2] === y);
    if (found) return found;
  }
  return null;
}
