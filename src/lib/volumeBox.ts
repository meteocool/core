/**
 * Which part of a volume's box is drawn.
 *
 * Since storms are boxed by map tile, each box's texture runs one voxel into
 * each neighbouring tile -- the header's `apron` -- so the field interpolates
 * across a seam instead of clamping at it. That voxel is the neighbour's to
 * draw: marched by both, the seam would be drawn twice, and outlined by both,
 * two outlines would overlap. Everything that draws or outlines a box asks
 * here for the part that is its own.
 *
 * Kept apart from `cellCutaway.ts`, which fetches, so the map layer and the
 * tests can use it without the fetching.
 */
import type { Cutaway, CutawayHeader } from "./cellCutaway";

/**
 * The part of the box that is drawn, as fractions of the texture on each
 * axis: from `min` to `max`. All of it for a volume without an apron.
 */
export function drawnPart(header: CutawayHeader): { min: [number, number, number]; max: [number, number, number] } {
  const [ax, ay, az] = header.apron ?? [0, 0, 0];
  const min: [number, number, number] = [ax / header.nx, ay / header.ny, az / header.nz];
  return { min, max: [1 - min[0], 1 - min[1], 1 - min[2]] };
}

/** The drawn part's size on each axis, in metres: the tile itself, for a tile. */
export function drawnExtentM(cutaway: Pick<Cutaway, "header" | "extentM">): [number, number, number] {
  const { min, max } = drawnPart(cutaway.header);
  return [0, 1, 2].map((axis) => cutaway.extentM[axis] * (max[axis] - min[axis])) as [number, number, number];
}

/** A part of a box, as fractions of its texture on each axis. */
export interface BoxPart {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * The part of the box that holds any echo at or above `dbzLow` the radars
 * saw, one voxel wider on every side, or null when there is none.
 *
 * Nothing outside it can be drawn: below `dbzLow` the shader's opacity is
 * zero, and a voxel's echo reaches its neighbour only by interpolation, which
 * the margin covers. So a ray need not march there -- the air above the
 * storm's top, and the empty part of a tile at the edge of a storm.
 */
export function echoPart(cutaway: Pick<Cutaway, "header" | "voxels">, dbzLow: number): BoxPart | null {
  const { header, voxels } = cutaway;
  const { nx, ny, nz } = header;
  const floor = Math.ceil((dbzLow - header.dbz_floor) * header.dbz_scale);
  let [x0, y0, z0, x1, y1, z1] = [nx, ny, nz, -1, -1, -1];
  let at = 0;
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1, at += 2) {
        if (voxels[at] < floor || voxels[at + 1] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
  }
  if (x1 < 0) return null;
  const fraction = (index: number, size: number) => Math.min(Math.max(index / size, 0), 1);
  return {
    min: [fraction(x0 - 1, nx), fraction(y0 - 1, ny), fraction(z0 - 1, nz)],
    max: [fraction(x1 + 2, nx), fraction(y1 + 2, ny), fraction(z1 + 2, nz)],
  };
}

/** Where two parts of one box overlap; empty (min past max) where they do not. */
export function overlap(a: BoxPart, b: BoxPart): BoxPart {
  return {
    min: [0, 1, 2].map((axis) => Math.max(a.min[axis], b.min[axis])) as [number, number, number],
    max: [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis])) as [number, number, number],
  };
}
