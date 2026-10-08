/**
 * Which tiles on the map are one storm, where the list does not say.
 *
 * The list names each tile's storm (`RadarVolume.system`), so its tiles can
 * peel as one cloud. An earlier scan's tiles are found in the bucket, whose
 * headers do not carry it, and coarse tiles are never given one. Each was
 * a storm of its own, peeled to its own floor: a weak tile beside its
 * storm's core kept its own small core standing while the core's tile
 * emptied, and a slider at its end no longer peeled the storm down to its core.
 *
 * Found here as the worker finds it (echo at or above `SEED_DBZ` in the
 * column, joined), but from the tiles' own voxels: two tiles that abut are
 * one storm where the storms of their peaks meet across the seam.
 */
import type { Cutaway } from "./cellCutaway";

/** What a storm is joined above, in the column's strongest echo: the worker's `volume_seed_dbz`. */
export const SEED_DBZ = 25;

/**
 * Where echo reaches a tile's four sides, one flag per voxel along each, in
 * map order: west to east along the north and south sides, north to south
 * down the west and east ones.
 */
export interface TileEdges {
  north: Uint8Array;
  south: Uint8Array;
  west: Uint8Array;
  east: Uint8Array;
}

/**
 * A tile's edges, as far as its own storm reaches them: the echo joined to
 * its strongest column, the worker's storm of the tile's peak. A tile with
 * two storms in it joins only by the one it is named for, or every storm
 * along a front would be one. Null for a box from before tiles, which joins
 * nothing.
 */
export function tileEdges({ header, voxels }: Pick<Cutaway, "header" | "voxels">): TileEdges | null {
  if (!header.tile) return null;
  const { nx, ny, nz } = header;
  const [ax, ay] = header.apron ?? [0, 0, 0];
  const [width, height] = [nx - 2 * ax, ny - 2 * ay];
  // The strongest byte the radars saw in each of its own columns, rows south to north.
  const strongest = new Int16Array(width * height).fill(-1);
  let at = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, at += 2) {
        if (x < ax || x >= nx - ax || y < ay || y >= ny - ay || voxels[at + 1] === 0) continue;
        const column = (y - ay) * width + (x - ax);
        if (voxels[at] > strongest[column]) strongest[column] = voxels[at];
      }
    }
  }
  const seed = Math.ceil((SEED_DBZ - header.dbz_floor) * header.dbz_scale);
  let peak = 0;
  for (let column = 1; column < strongest.length; column += 1) {
    if (strongest[column] > strongest[peak]) peak = column;
  }
  // The peak's storm, flooded out from it across columns that reach the seed.
  const storm = new Uint8Array(width * height);
  const queue = strongest[peak] >= seed ? [peak] : [];
  if (queue.length) storm[peak] = 1;
  while (queue.length) {
    const column = queue.pop()!;
    const [x, y] = [column % width, Math.floor(column / width)];
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const next = nextY * width + nextX;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height || storm[next] || strongest[next] < seed) continue;
      storm[next] = 1;
      queue.push(next);
    }
  }
  // The sides run north to south.
  const across = (y: number) => storm.slice(y * width, (y + 1) * width);
  const down = (x: number) => Uint8Array.from({ length: height }, (_, i) => storm[(height - 1 - i) * width + x]);
  return { north: across(height - 1), south: across(0), west: down(0), east: down(width - 1) };
}

/** A tile on the map, for `stormsOf`. */
export interface StormTile {
  network: string | null;
  tile: readonly [number, number, number] | null;
  /** Its storm, where the list says; see `RadarVolume.system`. */
  system: string | null;
  edges: TileEdges | null;
}

/** Whether echo reaches one point of a shared seam from both sides, a voxel either way. */
function meets(a: Uint8Array, aStart: number, aSize: number, b: Uint8Array, bStart: number, bSize: number,
  from: number, to: number): boolean {
  const at = (side: Uint8Array, start: number, size: number, where: number) => (
    Math.min(Math.max(Math.floor(((where - start) / size) * side.length), 0), side.length - 1)
  );
  const step = Math.min(aSize / a.length, bSize / b.length) / 2;
  for (let where = from + step / 2; where < to; where += step) {
    const i = at(a, aStart, aSize, where);
    const j = at(b, bStart, bSize, where);
    if (a[i] && (b[j] || b[Math.max(j - 1, 0)] || b[Math.min(j + 1, b.length - 1)])) return true;
  }
  return false;
}

/** Whether two tiles abut and echo crosses the seam between them. */
function joined(a: StormTile, b: StormTile): boolean {
  if (!a.tile || !b.tile || !a.edges || !b.edges || a.network !== b.network) return false;
  // Each on the unit square of the world, y running south: exact, the sizes being powers of two.
  const square = ([z, x, y]: readonly number[]) => {
    const size = 2 ** -z;
    return { west: x * size, north: y * size, east: (x + 1) * size, south: (y + 1) * size, size };
  };
  const [p, q] = [square(a.tile), square(b.tile)];
  const [top, bottom] = [Math.max(p.north, q.north), Math.min(p.south, q.south)];
  const [left, right] = [Math.max(p.west, q.west), Math.min(p.east, q.east)];
  if (p.east === q.west && top < bottom) return meets(a.edges.east, p.north, p.size, b.edges.west, q.north, q.size, top, bottom);
  if (q.east === p.west && top < bottom) return meets(a.edges.west, p.north, p.size, b.edges.east, q.north, q.size, top, bottom);
  if (p.south === q.north && left < right) return meets(a.edges.south, p.west, p.size, b.edges.north, q.west, q.size, left, right);
  if (q.south === p.north && left < right) return meets(a.edges.north, p.west, p.size, b.edges.south, q.west, q.size, left, right);
  return false;
}

/**
 * Each tile's storm, by its key: the list's `system` where it has one, and
 * where it has none the storm of the tiles its echo runs into across a seam,
 * or, joined to none of those, a storm named after one of its own tiles.
 * Two storms the list tells apart are never joined, only tiles it says
 * nothing of joined to them.
 */
export function stormsOf(tiles: Iterable<[string, StormTile]>): Map<string, string> {
  const held = [...tiles];
  const parent = held.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const named = new Map<string, number>();
  held.forEach(([, { system }], i) => {
    if (system === null) return;
    const first = named.get(system);
    if (first === undefined) named.set(system, i);
    else parent[root(i)] = root(first);
  });
  for (let i = 0; i < held.length; i += 1) {
    for (let j = i + 1; j < held.length; j += 1) {
      const [a, b] = [held[i][1], held[j][1]];
      if (a.system !== null && b.system !== null) continue;
      const [ri, rj] = [root(i), root(j)];
      if (ri === rj) continue;
      // Not where it would join two storms the list keeps apart.
      if (held[ri][1].system !== null && held[rj][1].system !== null && held[ri][1].system !== held[rj][1].system) continue;
      if (!joined(a, b)) continue;
      // A storm the list named keeps its name.
      if (held[ri][1].system !== null) parent[rj] = ri;
      else parent[ri] = rj;
    }
  }
  return new Map(held.map(([key, { system }], i) => [key, system ?? held[root(i)][1].system ?? `~${held[root(i)][0]}`]));
}
