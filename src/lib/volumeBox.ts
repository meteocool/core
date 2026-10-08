/**
 * Which part of a volume's box is drawn.
 *
 * Since storms are boxed by map tile, each box's texture runs one voxel into
 * each neighbouring tile (the header's `apron`), so the field interpolates
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
 * the margin covers. So a ray need not march there: the air above the
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

/** A tile's code, as the worker writes it (`Tile.code`): `T`, the zoom in two digits, x and y in five. */
export function tileCode(z: number, x: number, y: number): string {
  return `T${String(z).padStart(2, "0")}${String(x).padStart(5, "0")}${String(y).padStart(5, "0")}`;
}

/** The longitude and latitude of a tile's middle in Mercator, which is where a box filling it is centred. */
export function tileCentre(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  return [((x + 0.5) / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI];
}

/** A tile's west, south, east and north edges in degrees, as the map draws it. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** MapLibre's earth, as `cloudFootprint.ts` and the worker measure a tile by. */
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8;

/**
 * A core tile's parent, made of the four core tiles in it, for the panels.
 *
 * A core's tile is 13 km across, which is too narrow a window on a storm:
 * the panel's cut and sweep need the weather around the core too. The four
 * share their step and their voxel count, so their parent is their inner
 * voxels side by side, with the outer ring of their aprons as its apron. A
 * child that was not built (too little echo, or past a cap) is empty air.
 *
 * `children` holds the north-west, north-east, south-west and south-east
 * tiles in that order, null where one is missing; `own` is the one opened,
 * whose header the parent's is made from. Rows run south to north, so the
 * southern pair fills the lower rows.
 */
export function parentOf(
  own: Cutaway, children: ReadonlyArray<Cutaway | null>, place: (header: CutawayHeader, voxels: Uint8Array) => Cutaway,
): Cutaway {
  const { header } = own;
  const [z, x, y] = header.tile!;
  const apron = header.apron?.[0] ?? 0;
  const inner = header.nx - 2 * apron;
  const side = 2 * inner + 2 * apron;
  const childSide = header.nx;
  const voxels = new Uint8Array(side * side * header.nz * 2);
  for (let level = 0; level < header.nz; level += 1) {
    for (let row = 0; row < side; row += 1) {
      // The southern pair fills the lower rows, its own rows unshifted.
      const south = row < apron + inner;
      const childRow = south ? row : row - inner;
      for (const east of [0, 1]) {
        const child = children[(south ? 2 : 0) + east];
        if (!child) continue;
        // The western child gives its apron and inner columns, the eastern
        // its inner columns and apron, shifted left by one tile's inner width.
        const from = east ? apron + inner : 0;
        const to = east ? side : apron + inner;
        const source = ((level * childSide + childRow) * childSide + from - east * inner) * 2;
        const target = ((level * side + row) * side + from) * 2;
        voxels.set(child.voxels.subarray(source, source + (to - from) * 2), target);
      }
    }
  }
  const parent: [number, number, number] = [z - 1, x >> 1, y >> 1];
  const [lon, lat] = tileCentre(...parent);
  const step = (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / 2 ** parent[0] / (2 * inner);
  const present = children.filter((child): child is Cutaway => child !== null);
  return place({
    ...header,
    lon,
    lat,
    nx: side,
    ny: side,
    tile: parent,
    step_m: [step, step, header.step_m[2]],
    origin_m: [-(inner + apron) * step, -(inner + apron) * step, 0],
    sites: [...new Set(present.flatMap((child) => child.header.sites))].sort(),
    coverage: present.reduce((sum, child) => sum + child.header.coverage, 0) / present.length,
  }, voxels);
}
