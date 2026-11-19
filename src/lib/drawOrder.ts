/**
 * The order the 3D map draws its clouds in: far to near, tile by tile.
 *
 * Clouds are translucent, so each is blended over what was drawn before it,
 * and one drawn after a nearer one shows through it. Sorted by how deep the
 * middle of each box stands, two tiles side by side across the view stood
 * equally deep (exactly so, looking north), so half of them came out the
 * wrong way round, and the face where the farther tile begins, cut through
 * its core, was drawn over the nearer one: a sharp red slab at every seam.
 *
 * Tiles are cells of one quadtree, so there is an order that is never wrong:
 * at every node, the quarter farthest from the camera first and the one it
 * stands over last. Two tiles of a storm are always on two sides of the
 * line that split their smallest common tile, and the camera is on one side
 * of it, which is the side drawn later. Boxes stand from the ground up, so
 * the line on the ground is a wall through the sky, and the camera's height
 * makes no difference.
 *
 * Where one tile lies in another (two networks over one place, or a box from
 * before tiles), the quadtree has nothing to say, and depth decides.
 */

/**
 * The camera's position in Mercator, from the inverse of the matrix taking
 * Mercator to clip space: the one point that matrix sends to infinity.
 */
export function cameraOf(inverse: ArrayLike<number>): [number, number, number] {
  return [inverse[8] / inverse[11], inverse[9] / inverse[11], inverse[10] / inverse[11]];
}

/**
 * Where a tile stands in the far-to-near walk of the quadtree, one digit a
 * zoom level: at each node, 0 for the quarter farthest from the camera, 2
 * and 3 for the two beside it, 4 for the one it is in or nearest.
 */
export function walkOf(tile: readonly number[], camera: readonly number[]): number[] {
  const [z, x, y] = tile;
  const digits: number[] = [];
  for (let level = 0; level < z; level += 1) {
    const shift = z - level - 1;
    const east = (x >> shift) & 1;
    const south = (y >> shift) & 1;
    // The node's split lines, in Mercator: its middle.
    const size = 2 ** (level + 1);
    const splitX = (2 * (x >> (shift + 1)) + 1) / size;
    const splitY = (2 * (y >> (shift + 1)) + 1) / size;
    const away = Number(east !== Number(camera[0] >= splitX)) + Number(south !== Number(camera[1] >= splitY));
    digits.push(away === 2 ? 0 : away === 1 ? 2 + east : 4);
  }
  return digits;
}

/** Far before near between two walks; 0 where one tile lies in the other. */
function compareWalks(a: readonly number[], b: readonly number[]): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Clouds sorted far to near: by the quadtree where both are tiles, by depth
 * (larger first) where it cannot say.
 */
export function farToNear<T extends { tile: readonly number[] | null; depth: number }>(
  clouds: readonly T[], camera: readonly number[],
): T[] {
  const walks = new Map(clouds.map((cloud) => [cloud, cloud.tile ? walkOf(cloud.tile, camera) : null]));
  return [...clouds].sort((a, b) => {
    const [wa, wb] = [walks.get(a)!, walks.get(b)!];
    return (wa && wb ? compareWalks(wa, wb) : 0) || b.depth - a.depth;
  });
}
