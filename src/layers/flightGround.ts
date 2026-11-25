/**
 * The ground of the 3D map while flying: what MapLibre is told beyond its
 * options so that the view from a cockpit neither runs the GPU out of memory
 * nor turns the ground white when the eye looks up.
 *
 * Both reach into MapLibre's internals (6.x), as `applyTerrain`'s drape size
 * and the flight's near and far planes already do, and leave a MapLibre
 * without them as it is.
 *
 * - The drapes. MapLibre draws the ground's flat layers into a texture of
 *   their own for every terrain tile, by default twice the terrain tile's
 *   1024 pixels a side: 21 MB each with its mipmaps. Seen from above, a
 *   dozen or two tiles fill the screen; from a cockpit looking at the
 *   horizon, eighty, and the drapes alone held 1.6 GB, the page 2.8 GB of
 *   textures (November 2026). So while flying the drapes share a budget: the
 *   more tiles in view, the smaller each one's texture, down to half the
 *   terrain tile, and back up when fewer are.
 * - The haze. MapLibre fogs the ground by how far it is between two planes,
 *   the nearer one where the eye's line of sight meets the sea. Looking level
 *   or up that line never meets it: the depth it worked out ran to hundreds
 *   where 1 is the far plane, and its blend, which is not clamped, pushed
 *   every pixel of the ground past the fog's colour to white. While flying
 *   the nearer plane is worked out from the eye's height instead, the same as
 *   MapLibre's looking down, held where it is looking a degree short of
 *   level for every look above that.
 * - What the eye looks at. MapLibre places the camera by the point it looks
 *   at, found on the plane at the height the last one was: looking within a
 *   few degrees of level, a point 10 km off at nearly the eye's own height.
 *   The next look down found the ground tens of metres under the eye, the
 *   map's zoom went to 20 and past, and the tiles kept within a few levels of
 *   it ran to nearly two thousand: 3.7 GB of textures (November 2026). While
 *   flying that plane is the ground under the aircraft every frame, never
 *   less than `LEAST_LOOK_DOWN_M` under the eye.
 */
import type { Map as GlMap } from "maplibre-gl";

/** The bytes of one drape of this side, its mipmaps included. */
export function drapeBytes(size: number): number {
  return Math.round((size * size * 4 * 4) / 3);
}

/** The smallest a drape goes while flying, pixels a side: half a terrain tile. */
export const LEAST_DRAPE_SIZE = 512;

/** How far under the budget the tiles have to fall before the drapes grow again. */
const GROW_BELOW = 0.75;

/**
 * The side of the drapes for this many of them (tiles times the drapes each
 * has), within this many bytes: halved while they would not fit, doubled
 * back towards `largest` while twice the size would fit with room to spare,
 * so a count near the line does not flip the size every frame.
 */
export function drapeSizeWithin(count: number, bytes: number, current: number, largest: number): number {
  let size = Math.min(current, largest);
  while (size > LEAST_DRAPE_SIZE && count * drapeBytes(size) > bytes) size /= 2;
  while (size < largest && count * drapeBytes(size * 2) <= bytes * GROW_BELOW) size *= 2;
  return size;
}

/**
 * The fog's depth row from the camera's: for a projection with these entries
 * (column-major [10] and [14]), the two numbers that, times its depth row and
 * its w row, give a projection's depth row from `near` to `far` instead.
 * Every point the map draws has w 1 before projecting, which is what lets
 * the eye's depth be had back from the two rows.
 */
export function fogDepthRow(p10: number, p14: number, near: number, far: number): [number, number] {
  const f10 = (far + near) / (near - far);
  const f14 = (2 * far * near) / (near - far);
  return [f14 / p14, (f14 * p10) / p14 - f10];
}

/** The steepest look the fog's nearer plane follows: a degree short of level, from straight down. */
const FOG_PITCH_LIMIT = 89;

/**
 * The fog's nearer plane, pixels: where the line of sight meets the sea, from
 * an eye this high (pixels) looking this far from straight down (degrees),
 * held at `FOG_PITCH_LIMIT` for anything at or above level; never nearer
 * than the map's own near plane, and short of its far one.
 */
export function fogNear(height: number, pitch: number, nearZ: number, farZ: number): number {
  const along = Math.max(height, 1) / Math.cos((Math.min(pitch, FOG_PITCH_LIMIT) * Math.PI) / 180);
  return Math.min(Math.max(along, nearZ), farZ * 0.9);
}

/** The least the plane of what the eye looks at is under the eye, metres as drawn. */
export const LEAST_LOOK_DOWN_M = 100;

/** The height of the plane the eye looks at: the ground under it, at least `LEAST_LOOK_DOWN_M` below the eye. */
export function lookedAtHeight(ground: number, eye: number): number {
  return Math.min(ground, eye - LEAST_LOOK_DOWN_M);
}

/**
 * The camera as the map's level of detail is told of it: its zoom, how high
 * the eye is over what it looks at (`up`) and how far from it (`away`), in
 * one unit, for an eye that is really `over` over the ground.
 *
 * Looking down, the map has the eye look at the ground, and `up` is its
 * height over it. Within six degrees of level it looks at a point 10 km
 * ahead instead, in the air: `up` is then a few hundred metres, whatever the
 * altitude, and every tile to the horizon is taken to be seen from that low
 * and drawn two or three levels sharper than the same tile seen from a
 * degree further down. From a cockpit, which looks nearly level, that was
 * 260 tiles of imagery a frame for 40 (November 2026).
 *
 * So the eye is said to be as high as it is, looking the same way: the point
 * looked at further off along the same line, and the zoom less by as much,
 * which is the same picture. Never steeper than `leastRise` (the sine of the
 * least angle down), as before; and an eye already taken to be as high as it
 * is, is left as it was.
 */
export function lodCamera(
  zoom: number, up: number, away: number, over: number, leastRise: number,
): { zoom: number; up: number; away: number } {
  const least = Math.max(up, away * leastRise);
  if (!(over > least) || !(least > 0)) return { zoom, up: least, away };
  const further = over / least;
  return { zoom: zoom - Math.log2(further), up: over, away: away * further };
}

interface Tile {
  rttObjects?: Array<{ size: number } | undefined>;
  releaseRTT(painter: unknown): void;
}
interface Drapes {
  rttSize: number;
  _renderableTiles?: Tile[];
  _stacks?: unknown[];
  prepareForRender(style: unknown, zoom: number): void;
}
interface Transform {
  pitch: number;
  nearZ: number;
  farZ: number;
  pixelsPerMeter: number;
  projectionMatrix?: ArrayLike<number>;
  modelViewProjectionMatrix?: unknown;
  getCameraAltitude?(): number;
  calculatePosMatrix?(tile: unknown, aligned: boolean, useFloat32: true): Float32Array;
  calculateFogMatrix?(tile: { key: string | number }): Float32Array;
  _fogMatrixCacheF32?: Map<unknown, unknown>;
}
interface Painter {
  renderToTexture?: Drapes | null;
  transform?: Transform;
}
const painterOf = (gl: GlMap) => (gl as unknown as { painter?: Painter }).painter;

/** Each drapes' budget while flying, and the size they had before it. */
const budgets = new WeakMap<Drapes, { bytes: number; own: number }>();
const patched = new WeakSet<Drapes>();

/**
 * Hold the terrain's drapes within this many bytes, or (null) let them be as
 * MapLibre has them again. Called every frame of a flight: the drapes are
 * made anew whenever the terrain is.
 */
export function budgetDrapes(gl: GlMap, bytes: number | null): void {
  const painter = painterOf(gl);
  const drapes = painter?.renderToTexture;
  if (!drapes || typeof drapes.rttSize !== "number" || typeof drapes.prepareForRender !== "function") return;
  const budget = budgets.get(drapes);
  if (bytes === null) {
    if (!budget) return;
    budgets.delete(drapes);
    drapes.rttSize = budget.own;
    return;
  }
  if (budget) budget.bytes = bytes;
  else budgets.set(drapes, { bytes, own: drapes.rttSize });
  if (patched.has(drapes)) return;
  patched.add(drapes);
  const prepare = drapes.prepareForRender;
  drapes.prepareForRender = function (this: Drapes, style: unknown, zoom: number) {
    // What it is about to clear: how many drapes each tile had last frame.
    const stacks = Math.max(1, this._stacks?.length ?? 1);
    prepare.call(this, style, zoom);
    const held = budgets.get(this);
    const tiles = this._renderableTiles;
    if (!held || !tiles) return;
    const size = drapeSizeWithin(tiles.length * stacks, held.bytes, this.rttSize, held.own);
    if (size < this.rttSize) {
      // Smaller from now on, and the larger ones drawn again at it: the tiles in view are what was over.
      for (const tile of tiles) {
        if (tile.rttObjects?.some((drape) => drape && drape.size > size)) tile.releaseRTT(painter);
      }
    }
    this.rttSize = size;
  };
}

const fogged = new WeakSet<Transform>();

/**
 * Work the ground's haze out from the eye's height (see the top of this
 * file), or (false) as MapLibre does again. Called every frame of a flight:
 * a change of projection makes the transform anew.
 */
export function flightFog(gl: GlMap, on: boolean): void {
  const transform = painterOf(gl)?.transform;
  const placed = transform?.calculatePosMatrix;
  if (!transform || typeof placed !== "function" || typeof transform.calculateFogMatrix !== "function") return;
  if (!on) {
    if (!fogged.has(transform)) return;
    fogged.delete(transform);
    delete (transform as { calculateFogMatrix?: unknown }).calculateFogMatrix;
    transform._fogMatrixCacheF32?.clear();
    return;
  }
  if (fogged.has(transform)) return;
  fogged.add(transform);
  const cache = new Map<string | number, Float32Array>();
  let drawnBy: unknown = null;
  transform.calculateFogMatrix = function (this: Transform, tile: { key: string | number }) {
    // The view's matrix is made anew whenever the camera moves: the cache is good for as long as it is.
    if (this.modelViewProjectionMatrix !== drawnBy) {
      cache.clear();
      drawnBy = this.modelViewProjectionMatrix;
    }
    const held = cache.get(tile.key);
    if (held) return held;
    const position = placed.call(this, tile, false, true);
    const projection = this.projectionMatrix;
    const matrix = new Float32Array(position);
    if (projection) {
      const height = (this.getCameraAltitude?.() ?? 0) * this.pixelsPerMeter;
      const [depth, w] = fogDepthRow(projection[10], projection[14], fogNear(height, this.pitch, this.nearZ, this.farZ), this.farZ);
      for (let column = 0; column < 4; column += 1) {
        matrix[column * 4 + 2] = depth * position[column * 4 + 2] + w * position[column * 4 + 3];
      }
    }
    cache.set(tile.key, matrix);
    return matrix;
  };
}
