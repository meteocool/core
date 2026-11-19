/**
 * How far the storms moved from one scan to the next, worked out from their
 * volumes.
 *
 * Studio plays a scene as a film, and the radar sees the storms once every
 * five minutes. Between two scans the map draws both, the earlier carried
 * forward and the later carried back along the storms' motion, each weighted
 * by how near its own scan the moment is (layers/cellVolumeLayer.ts), so a
 * storm moves across rather than fading out in one place and in at another.
 * That needs the motion, and this finds it.
 *
 * From the volumes themselves, not from anything else the app knows of
 * motion. The rain's motion arrows are a field of their own, fetched as
 * tiles, made from the flat composite and drawn as arrows; a KONRAD3D cell's
 * track has a heading and a speed, but only for the newest scan, and only
 * for the cells it found, not for the tiles of sky drawn here. Matched from
 * the two volumes that are being blended, the motion needs no further
 * request, and it is the motion of exactly what is drawn: the two pictures
 * are put on top of each other where they agree best.
 *
 * How: how deep the storm stands in each column (kilometres of echo from
 * moderate rain up), of every tile of both scans, laid on one grid of about
 * a kilometre a cell over the ground; then for each storm, the earlier
 * scan's picture of it slid over the later one's until the two differ
 * least, coarse first over the whole reach a storm can travel in a scan,
 * then fine around the best, then between cells by the shape of the
 * difference around its least.
 *
 * The depth, not the strongest echo in the column. Tried on the demo's
 * storms over the Gulf of Lion, the strongest echo was a shield of rain
 * that stood still while the cells in it moved north, and the match said
 * they had not moved; the depth is the towers, which are what a reader sees
 * move, and it found them a few kilometres north each scan, as their cores
 * went.
 *
 * One motion per storm, not per tile. Each tile of sky is a box of its own,
 * and the tiles of one storm moved by different amounts would come apart at
 * their seams. So the storms are the echo joined across the grid, in either
 * scan, and every tile touching one storm moves with it; tiles touching two
 * join them into one. In widespread rain that is one storm over everything,
 * which is the safe answer. A storm with too little echo to match, or whose
 * best match is at the edge of the reach (no match at all, really), moves
 * with all the storms together; with none to match, nothing moves.
 */
import type { Cutaway } from "./cellCutaway";

/** A displacement on the map, in Mercator units (the world 0 to 1, y running south). */
export type Drift = readonly [number, number];

/** One tile of sky of one of the two scans: `side` 0 the earlier, 1 the later. */
export interface MotionTile {
  key: string;
  side: 0 | 1;
  cutaway: Pick<Cutaway, "header" | "voxels" | "extentM">;
}

export interface Motion {
  /** Every storm in view together: what a storm with nothing to match by moves with. Null where nothing matched. */
  all: Drift | null;
  /** Each tile's, by key, from its scan to the other: the same for every tile of one storm. */
  byKey: Map<string, Drift>;
}

/** The grid the columns are laid on, in km a cell, and how many cells it may run to before it is made coarser. */
const CELL_KM = 1;
const MAX_CELLS = 160_000;
/**
 * How far a storm can go in a scan, in km: 16 km in five minutes is 190
 * km/h, past any storm's own motion, with room for a scan the archive
 * skipped.
 */
const REACH_KM = 16;
/**
 * What counts towards a column's depth, in dBZ: nothing under `DEPTH_DBZ`,
 * all of a layer from a band over it, smoothly between, and less where the
 * radars saw it poorly. Moderate rain up: under it is the shield every
 * storm stands in, which moves little and changes shape a lot.
 */
const DEPTH_DBZ = 30;
const DEPTH_BAND = 15;
/** How deep a column has to be, in km, to be storm: a layer of it, about. */
const STORM_KM = 0.25;
/** The least of a storm, in cells, that is matched on its own: smaller follows every storm together. */
const MIN_CELLS = 24;
/**
 * A slight preference for moving less, per km squared of motion: where the
 * picture says nothing either way (a flat shield of rain) it stays put
 * rather than drifting wherever the noise is least.
 */
const PRIOR_PER_KM2 = 0.0005;

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;

/** Web Mercator, as MapLibre's `MercatorCoordinate` has it. */
export function mercator(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2];
}

/** One metre on the ground at this latitude, in Mercator units. */
export const metreAt = (lat: number): number => 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180));

/** A drift in km east and north, at a latitude: for reading one, not for drawing. */
export function driftKm([dx, dy]: Drift, lat: number): [number, number] {
  const metre = metreAt(lat);
  return [dx / metre / 1000, -dy / metre / 1000];
}

/**
 * How deep the storm stands in each of a volume's columns, in km, rows south
 * to north; see `DEPTH_DBZ`. Kept per volume: a volume is immutable, and
 * Studio works it out as each one lands, not when a pair of scans is first
 * blended: it costs a pass over every voxel.
 */
const depths = new WeakMap<Uint8Array, Float32Array>();

export function columnDepth({ header, voxels }: Pick<Cutaway, "header" | "voxels">): Float32Array {
  const known = depths.get(voxels);
  if (known) return known;
  const { nx, ny, nz } = header;
  const plane = nx * ny;
  // Each stored byte's share of a layer, confidence aside.
  const share = new Float32Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    const t = Math.min(Math.max((byte / header.dbz_scale + header.dbz_floor - DEPTH_DBZ) / DEPTH_BAND, 0), 1);
    share[byte] = (t * t * (3 - 2 * t) * header.step_m[2]) / 1000 / 255;
  }
  const depth = new Float32Array(plane);
  for (let z = 0, at = 0; z < nz; z += 1) {
    for (let i = 0; i < plane; i += 1, at += 2) depth[i] += share[voxels[at]] * voxels[at + 1];
  }
  depths.set(voxels, depth);
  return depth;
}

/** Where a tile's own ground lies on the map, apron left out, in Mercator: west, north, east, south. */
function groundOf(cutaway: MotionTile["cutaway"]): { west: number; north: number; east: number; south: number } {
  const { header, extentM } = cutaway;
  const [x, y] = mercator(header.lon, header.lat);
  const metre = metreAt(header.lat);
  const [width, height] = [extentM[0] * metre, extentM[1] * metre];
  const [ax, ay] = header.apron ?? [0, 0, 0];
  const [insetX, insetY] = [(ax / header.nx) * width, (ay / header.ny) * height];
  return {
    west: x - width / 2 + insetX, east: x + width / 2 - insetX, north: y - height / 2 + insetY, south: y + height / 2 - insetY,
  };
}

/** The two scans' echo on one grid, and where each tile lies on it. */
interface Grid {
  width: number;
  height: number;
  /** A cell's side, in Mercator and in km. */
  cell: number;
  cellKm: number;
  /** How deep the storm stands in each cell, in km, in each scan; nothing where no tile is. */
  fields: [Float32Array, Float32Array];
  /** The cells each tile covers, in the order of the tiles. */
  cells: Int32Array[];
}

const clampIndex = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));

function gridOf(tiles: readonly MotionTile[]): Grid {
  const grounds = tiles.map(({ cutaway }) => groundOf(cutaway));
  const west = Math.min(...grounds.map((ground) => ground.west));
  const east = Math.max(...grounds.map((ground) => ground.east));
  const north = Math.min(...grounds.map((ground) => ground.north));
  const south = Math.max(...grounds.map((ground) => ground.south));
  const lat = tiles.reduce((sum, { cutaway }) => sum + cutaway.header.lat, 0) / tiles.length;
  let cellKm = CELL_KM;
  const metre = metreAt(lat);
  const cellsAt = (km: number) => Math.ceil((east - west) / (km * 1000 * metre)) * Math.ceil((south - north) / (km * 1000 * metre));
  while (cellsAt(cellKm) > MAX_CELLS) cellKm *= 1.5;
  const cell = cellKm * 1000 * metre;
  const width = Math.max(1, Math.ceil((east - west) / cell));
  const height = Math.max(1, Math.ceil((south - north) / cell));
  const sums: [Float32Array, Float32Array] = [new Float32Array(width * height), new Float32Array(width * height)];
  const counts: [Uint16Array, Uint16Array] = [new Uint16Array(width * height), new Uint16Array(width * height)];
  const cells = tiles.map(({ side, cutaway }, index) => {
    const ground = grounds[index];
    const { nx, ny } = cutaway.header;
    const [ax, ay] = cutaway.header.apron ?? [0, 0, 0];
    const column = columnDepth(cutaway);
    // A column's size on the map, and the tile's own columns' span.
    const across = (ground.east - ground.west) / (nx - 2 * ax);
    const down = (ground.south - ground.north) / (ny - 2 * ay);
    const covered: number[] = [];
    const [columnsAcross, rowsDown] = [nx - 2 * ax, ny - 2 * ay];
    const [x0, x1] = [Math.max(0, Math.floor((ground.west - west) / cell)), Math.min(width, Math.ceil((ground.east - west) / cell))];
    const [y0, y1] = [Math.max(0, Math.floor((ground.north - north) / cell)), Math.min(height, Math.ceil((ground.south - north) / cell))];
    for (let gy = y0; gy < y1; gy += 1) {
      // The tile's rows under this cell, or the nearest one where a row is wider than a cell. Rows run south to north.
      const top = north + gy * cell;
      const middleY = top + cell / 2;
      if (middleY < ground.north || middleY >= ground.south) continue;
      const fromSouth = ground.south - middleY;
      const r0 = down >= cell
        ? Math.min(rowsDown - 1, Math.floor(fromSouth / down))
        : clampIndex(Math.floor((fromSouth - cell / 2) / down), rowsDown);
      const r1 = down >= cell ? r0 : Math.max(r0, clampIndex(Math.ceil((fromSouth + cell / 2) / down) - 1, rowsDown));
      for (let gx = x0; gx < x1; gx += 1) {
        // The same for its columns.
        const left = west + gx * cell;
        const middleX = left + cell / 2;
        if (middleX < ground.west || middleX >= ground.east) continue;
        const i0 = across >= cell
          ? Math.min(columnsAcross - 1, Math.floor((middleX - ground.west) / across))
          : clampIndex(Math.floor((left - ground.west) / across), columnsAcross);
        const i1 = across >= cell ? i0 : Math.max(i0, clampIndex(Math.ceil((left + cell - ground.west) / across) - 1, columnsAcross));
        let sum = 0;
        let count = 0;
        for (let row = r0; row <= r1; row += 1) {
          for (let i = i0; i <= i1; i += 1) {
            sum += column[(row + ay) * nx + i + ax];
            count += 1;
          }
        }
        const at = gy * width + gx;
        sums[side][at] += sum / count;
        counts[side][at] += 1;
        covered.push(at);
      }
    }
    return Int32Array.from(covered);
  });
  const fields = sums.map((sum, side) => sum.map((value, at) => (
    counts[side][at] ? value / counts[side][at] : 0
  ))) as [Float32Array, Float32Array];
  return { width, height, cell, cellKm, fields, cells };
}

/** A field at half the resolution, each cell the mean of four. */
function halved(field: Float32Array, width: number, height: number): { field: Float32Array; width: number; height: number } {
  const [w, h] = [Math.ceil(width / 2), Math.ceil(height / 2)];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const [sx, sy] = [2 * x + dx, 2 * y + dy];
          if (sx >= width || sy >= height) continue;
          sum += field[sy * width + sx];
          count += 1;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return { field: out, width: w, height: h };
}

/** `halved`, once a field: every storm is matched on the same two. */
const halves = new WeakMap<Float32Array, ReturnType<typeof halved>>();
function halvedOnce(field: Float32Array, width: number, height: number): ReturnType<typeof halved> {
  let known = halves.get(field);
  if (!known) {
    known = halved(field, width, height);
    halves.set(field, known);
  }
  return known;
}

/**
 * How badly `from` slid by (sx, sy) cells matches `to`, over the `template`
 * cells of `from`: the mean difference in km of storm, a little more the further it
 * slid. Past the grid's edge is no echo.
 */
function mismatch(
  from: Float32Array, to: Float32Array, width: number, height: number, template: Int32Array, sx: number, sy: number,
  cellKm: number,
): number {
  let sum = 0;
  for (let k = 0; k < template.length; k += 1) {
    const at = template[k];
    const [x, y] = [at % width + sx, Math.floor(at / width) + sy];
    const there = x < 0 || y < 0 || x >= width || y >= height ? 0 : to[y * width + x];
    sum += Math.abs(from[at] - there);
  }
  const km2 = (sx * sx + sy * sy) * cellKm * cellKm;
  return (sum / template.length) * (1 + PRIOR_PER_KM2 * km2);
}

/** Where a parabola through three values has its least, as an offset from the middle one, -0.5 to 0.5. */
function vertex(before: number, at: number, after: number): number {
  const curve = before - 2 * at + after;
  return curve > 1e-9 ? Math.min(Math.max((before - after) / (2 * curve), -0.5), 0.5) : 0;
}

/**
 * The slide, in cells, that takes `template` of `from` onto `to`; null where
 * the best is at the edge of the reach, which is no match.
 */
function bestSlide(
  grid: Grid, from: Float32Array, to: Float32Array, template: Int32Array,
): [number, number] | null {
  const { width, height, cellKm } = grid;
  // Coarse: the whole reach at twice the cell, over the template's cells halved.
  const half = [halvedOnce(from, width, height), halvedOnce(to, width, height)];
  const coarseTemplate = Int32Array.from(new Set(Array.from(template, (at) => (
    Math.floor(Math.floor(at / width) / 2) * half[0].width + Math.floor((at % width) / 2)
  ))));
  const reach = Math.max(1, Math.ceil(REACH_KM / (2 * cellKm)));
  let best = { cost: Infinity, x: 0, y: 0 };
  for (let sy = -reach; sy <= reach; sy += 1) {
    for (let sx = -reach; sx <= reach; sx += 1) {
      const cost = mismatch(half[0].field, half[1].field, half[0].width, half[0].height, coarseTemplate, sx, sy, 2 * cellKm);
      if (cost < best.cost) best = { cost, x: sx, y: sy };
    }
  }
  if (Math.abs(best.x) === reach || Math.abs(best.y) === reach) return null;
  // Fine: around twice that, a cell at a time.
  const costs = new Map<string, number>();
  const cost = (sx: number, sy: number) => {
    const key = `${sx},${sy}`;
    let known = costs.get(key);
    if (known === undefined) {
      known = mismatch(from, to, width, height, template, sx, sy, cellKm);
      costs.set(key, known);
    }
    return known;
  };
  let fine = { cost: Infinity, x: 0, y: 0 };
  for (let sy = 2 * best.y - 2; sy <= 2 * best.y + 2; sy += 1) {
    for (let sx = 2 * best.x - 2; sx <= 2 * best.x + 2; sx += 1) {
      const here = cost(sx, sy);
      if (here < fine.cost) fine = { cost: here, x: sx, y: sy };
    }
  }
  // Between cells, from the difference either side of the least on each axis.
  return [
    fine.x + vertex(cost(fine.x - 1, fine.y), fine.cost, cost(fine.x + 1, fine.y)),
    fine.y + vertex(cost(fine.x, fine.y - 1), fine.cost, cost(fine.x, fine.y + 1)),
  ];
}

/** The cells of `side` among these that are storm; see `STORM_KM`. */
function stormCells(grid: Grid, side: 0 | 1, cells: Iterable<number>): Int32Array {
  const field = grid.fields[side];
  return Int32Array.from([...cells].filter((at) => field[at] >= STORM_KM));
}

/** The motion of one template, as a drift from the earlier scan to the later; null where it found none. */
function driftOf(grid: Grid, side: 0 | 1, template: Int32Array): Drift | null {
  if (template.length < MIN_CELLS) return null;
  const [from, to] = side === 0 ? grid.fields : [grid.fields[1], grid.fields[0]];
  const slide = bestSlide(grid, from, to, template);
  if (!slide) return null;
  // Matched from the later scan, it is the way back.
  const sign = side === 0 ? 1 : -1;
  return [sign * slide[0] * grid.cell, sign * slide[1] * grid.cell];
}

/**
 * The tiles grouped into storms: echo joined across the grid in either
 * scan, and tiles over one piece of it together. A tile with no echo is a
 * group of its own.
 */
function stormsOfGrid(grid: Grid, tiles: readonly MotionTile[]): number[][] {
  const { width, height, fields } = grid;
  const label = new Int32Array(width * height).fill(-1);
  const joined = (at: number) => fields[0][at] >= STORM_KM || fields[1][at] >= STORM_KM;
  let labels = 0;
  for (let start = 0; start < label.length; start += 1) {
    if (label[start] >= 0 || !joined(start)) continue;
    label[start] = labels;
    const queue = [start];
    while (queue.length) {
      const at = queue.pop()!;
      const [x, y] = [at % width, Math.floor(at / width)];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (label[next] >= 0 || !joined(next)) continue;
          label[next] = labels;
          queue.push(next);
        }
      }
    }
    labels += 1;
  }
  // Tiles over one piece of echo are one storm: union them through their pieces.
  const parent = tiles.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const owner = new Map<number, number>();
  grid.cells.forEach((cells, tile) => {
    for (const at of cells) {
      if (label[at] < 0) continue;
      const first = owner.get(label[at]);
      if (first === undefined) owner.set(label[at], tile);
      else if (root(first) !== root(tile)) parent[root(tile)] = root(first);
    }
  });
  const groups = new Map<number, number[]>();
  tiles.forEach((_, i) => groups.set(root(i), [...groups.get(root(i)) ?? [], i]));
  return [...groups.values()];
}

/**
 * Each tile's drift from its scan to the other, one per storm; see the top
 * of this file. Tiles of one scan only, or none, move nowhere.
 */
export function cloudMotion(tiles: readonly MotionTile[]): Motion {
  const byKey = new Map<string, Drift>();
  if (!tiles.some(({ side }) => side === 0) || !tiles.some(({ side }) => side === 1)) {
    for (const { key } of tiles) byKey.set(key, [0, 0]);
    return { all: null, byKey };
  }
  const grid = gridOf(tiles);
  const everything = (side: 0 | 1) => stormCells(grid, side, grid.cells.flatMap((cells, i) => (
    tiles[i].side === side ? Array.from(cells) : []
  )));
  const all = driftOf(grid, 0, everything(0)) ?? driftOf(grid, 1, everything(1));
  for (const group of stormsOfGrid(grid, tiles)) {
    // Matched from the scan that has more of it: a storm that is born has nothing earlier to match.
    const of = (side: 0 | 1) => stormCells(grid, side, group.flatMap((i) => (tiles[i].side === side ? Array.from(grid.cells[i]) : [])));
    const [earlier, later] = [of(0), of(1)];
    const drift = (earlier.length >= later.length
      ? driftOf(grid, 0, earlier) ?? driftOf(grid, 1, later)
      : driftOf(grid, 1, later) ?? driftOf(grid, 0, earlier)) ?? all ?? [0, 0];
    for (const i of group) byKey.set(tiles[i].key, drift);
  }
  return { all, byKey };
}
