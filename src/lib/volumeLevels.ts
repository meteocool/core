/**
 * Which volumes the 3D map draws, coarse or fine, place by place.
 *
 * Every run builds, over its tiles, the coarse zoom-9 tile each lies in, at
 * about 1 km a voxel: four times a tile's ground for a quarter of its
 * texture. Where a coarse tile is small on screen the map draws it in place
 * of the tiles in it, so a whole outbreak fits the textures a few dozen tiles
 * would take, and the voxels it skips are finer than the screen there
 * anyway. Where it is large (close to the camera), the map draws the
 * tiles. Never both over the same ground.
 */
import type { RadarVolume } from "../api";

/** The zoom the worker builds coarse tiles at (`voxels.COARSE_ZOOM`). */
export const COARSE_ZOOM = 9;

/**
 * What the 3D map asks `/cells/volumes` for at `at` (unix seconds, null for
 * now): its coarse tiles, and with `fillSky` the fill tiles too, the weak
 * echo where no storm is. Only meteoair's page draws the whole sky; the map
 * asks exactly what it did before there were fill tiles.
 */
export function volumesAsked(fillSky: boolean, at: number | null): { coarse: true; fill?: true; at: number | null } {
  return fillSky ? { coarse: true, fill: true, at } : { coarse: true, at };
}

/** The coarse tile a tile lies in, as `x/y` at `COARSE_ZOOM`. */
function coarseKey(tile: readonly number[]): string | null {
  const [z, x, y] = tile;
  const shift = z - COARSE_ZOOM;
  return shift >= 0 ? `${x >> shift}/${y >> shift}` : null;
}

/**
 * The volumes to draw, with each coarse tile drawn where `coarse` says so.
 *
 * A coarse tile drawn stands in for the tiles in it; one not drawn leaves
 * them to be. A tile whose coarse tile was not built (the run was cut short
 * before it) is drawn itself. A volume from before tiles is drawn either
 * way. The open volume is always drawn, and the coarse tile over it is not:
 * an open storm keeps its own picture while the reader zooms out.
 *
 * With `weak`, a sky drawn whole (meteoair's): a coarse tile drawn as its
 * tiles is drawn as well where none of them lies, over its weak echo
 * (`weakParts`), counting only the tiles `weak.covers` says are drawn.
 * Without it, a coarse tile is drawn whole or not at all, as on the map.
 */
export function atLevel(
  clouds: readonly RadarVolume[], coarse: (tile: readonly number[]) => boolean, openPath: string | null = null,
  weak: { covers(cloud: RadarVolume): boolean } | null = null,
): RadarVolume[] {
  const fine = clouds.filter((cloud) => !cloud.coarse);
  const open = openPath ? clouds.find((cloud) => cloud.path === openPath && !cloud.coarse) : undefined;
  const openKey = open?.tile ? coarseKey(open.tile) : null;
  const parents = clouds.filter((cloud) => (
    cloud.coarse && cloud.tile && coarseKey(cloud.tile) !== openKey && coarse(cloud.tile)
  ));
  const covered = new Set(parents.map((cloud) => coarseKey(cloud.tile!)));
  const drawnWhole = new Set(parents);
  // Drawn as their tiles, and over what of their ground those leave.
  const partly = weak ? clouds.filter((cloud) => (
    cloud.coarse && cloud.tile && !drawnWhole.has(cloud)
    && weakParts(cloud.tile, coveringTiles(cloud, fine.filter((tile) => weak.covers(tile)))).length > 0
  )) : [];
  return [
    ...parents,
    ...partly,
    ...fine.filter((cloud) => !cloud.tile || !covered.has(coarseKey(cloud.tile)) || cloud.path === openPath),
  ];
}

/**
 * The tiles of `fine` that lie in a coarse tile, of its own network: two
 * networks overlap at their borders and each draws its own sky there.
 */
export function coveringTiles(
  parent: Pick<RadarVolume, "tile" | "network">, fine: readonly Pick<RadarVolume, "tile" | "network" | "coarse">[],
): Array<readonly number[]> {
  const key = parent.tile ? coarseKey(parent.tile) : null;
  if (key === null) return [];
  return fine.flatMap((cloud) => (
    !cloud.coarse && cloud.tile && (cloud.network ?? "de") === (parent.network ?? "de") && coarseKey(cloud.tile) === key
      ? [cloud.tile] : []
  ));
}

/**
 * The parts of a tile no tile of `fine` lies over, as the fewest tiles of
 * the map's own grid: a quarter whole where nothing lies in it, its own
 * quarters where something does in some of them, and so on down to the
 * finest of `fine`. Empty where `fine` covers it all; the tile itself
 * where none of them lies in it.
 *
 * Every run builds a coarse tile over each storm's tiles, and it holds the
 * rain round the storm as well, across its whole ground. The storm's own
 * tiles cover only the storm: a quarter with no storm in it has none, nor
 * does the part of a core's tile its cores leave out. Drawn as its tiles
 * alone, close up, a coarse tile's weak echo there was not drawn at all.
 */
export function weakParts(tile: readonly number[], fine: readonly (readonly number[])[]): number[][] {
  const [z, x, y] = tile;
  const inside = fine.filter((one) => one[0] >= z && overTile(one, tile));
  if (!inside.length) return [[z, x, y]];
  // A tile of `fine` as large as this one, or this one itself, covers all of it.
  if (inside.some((one) => one[0] === z)) return [];
  const parts: number[][] = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    parts.push(...weakParts([z + 1, x * 2 + dx, y * 2 + dy], inside));
  }
  return parts;
}

/** Whether a tile lies in another, as large or larger: the same, or one of its quarters, theirs, and so on. */
function overTile(inner: readonly number[], outer: readonly number[]): boolean {
  const shift = inner[0] - outer[0];
  return shift >= 0 && inner[1] >> shift === outer[1] && inner[2] >> shift === outer[2];
}

/** The column and row of the zoom-`z` tile a point stands in, as the map numbers them. */
export function tileAt(lon: number, lat: number, z: number): [number, number] {
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

/** West, south, east, north, in degrees. */
export type Bounds = readonly [number, number, number, number];

/**
 * Whether any of a stretch of ground stands on screen.
 *
 * By its footprint, not its middle: a coarse tile is 40 km across, and one
 * whose middle stood just past the edge of the screen while most of it
 * filled a corner was ranked as off screen, behind stronger storms that
 * were (`wanted`). Cut to the map's bounds first: a point past the horizon
 * projects to somewhere meaningless, which can be on the canvas.
 */
export function footprintOnScreen(
  ground: Bounds, view: Bounds, project: (lonLat: [number, number]) => { x: number; y: number },
  width: number, height: number,
): boolean {
  const [west, south, east, north] = [
    Math.max(ground[0], view[0]), Math.max(ground[1], view[1]), Math.min(ground[2], view[2]), Math.min(ground[3], view[3]),
  ];
  if (west > east || south > north) return false;
  const corners = ([[west, south], [east, south], [east, north], [west, north]] as const)
    .map(([lon, lat]) => project([lon, lat]));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return Math.max(...xs) >= 0 && Math.min(...xs) <= width && Math.max(...ys) >= 0 && Math.min(...ys) <= height;
}

/** A coarse tile that stands large enough to be drawn as its tiles, and what that costs. */
export interface FineCandidate {
  code: string;
  /** How large it stands on screen, in pixels across. */
  across: number;
  /** Its own texture, and its tiles' together, in bytes. */
  coarseBytes: number;
  fineBytes: number;
}

/**
 * Which coarse tiles to draw as their tiles: the largest on screen first,
 * as far as `spare` bytes go over drawing every one of them coarse.
 *
 * Tilted over a large outbreak, every coarse tile near the camera turned
 * fine at once, the fine tiles outran the textures the map holds, and the
 * weakest tiles in view were left out, in the middle of a storm. Kept
 * coarse where the budget runs out instead, a place is drawn at a coarser
 * grain rather than not at all.
 */
export function fineWithin(candidates: readonly FineCandidate[], spare: number): Set<string> {
  const fine = new Set<string>();
  let left = spare;
  for (const candidate of [...candidates].sort((a, b) => b.across - a.across)) {
    const extra = candidate.fineBytes - candidate.coarseBytes;
    if (extra > left) continue;
    left -= extra;
    fine.add(candidate.code);
  }
  return fine;
}
