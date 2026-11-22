/**
 * The shapes of a flight's water (water.ts), cut from the basemap's own
 * tiles: each tile's lakes, rivers and sea as triangles in that tile's
 * coordinates, and how high each surface lies.
 *
 * No GL here: what is in a tile and how it is cut up, apart from how it is
 * drawn, so that it can be tested without a map.
 */
import earcut from "earcut";

/** A point of a tile's geometry, in the tile's own units (0 to its extent). */
export interface TilePoint {
  x: number;
  y: number;
}

/** What a vector tile's feature offers that the water needs. */
export interface WaterFeature {
  /** 1 a point, 2 a line, 3 a polygon. */
  type: number;
  id?: number | string;
  properties: Record<string, unknown>;
  loadGeometry(): TilePoint[][];
}

/**
 * How a surface is given its height.
 *
 * - `level`: a lake, a reservoir, a harbour basin. Still water is flat, so
 *   one height for all of it: the lowest the ground is measured round it.
 * - `sloped`: a river or a canal, which runs downhill. A level surface the
 *   length of a valley would be under the ground at one end, so each corner
 *   takes the ground's own height there.
 * - `either`: water the tiles say no more of. Level where the ground round
 *   it is (a pond, a lagoon), sloped where it is not (a stretch of river).
 * - `sea`: at sea level.
 */
export type Surface = "level" | "sloped" | "either" | "sea";

/** Which of the tiles' water is drawn, and how its height is found: by `kind`, then `kind_detail`. */
const SLOPED = new Set(["river", "canal", "stream", "ditch", "drain", "riverbank"]);
const LEVEL = new Set(["lake", "reservoir", "basin", "dock", "pond", "lagoon", "water_storage"]);

/**
 * The surface a feature of the basemap's `water` layer has, or null for one
 * not drawn: points and lines (labels and the thin rivers), reefs, fountains
 * and pools, and the sea unless `withSea`.
 */
export function surfaceOf(feature: Pick<WaterFeature, "type" | "properties">, withSea: boolean): Surface | null {
  if (feature.type !== 3) return null;
  const kind = feature.properties.kind;
  const detail = feature.properties.kind_detail;
  if (kind === "ocean" || kind === "sea") return withSea ? "sea" : null;
  if (kind === "lake" || kind === "reservoir") return "level";
  if (kind === "river" || kind === "canal") return "sloped";
  if (kind !== "water") return null;
  if (typeof detail === "string" && SLOPED.has(detail)) return "sloped";
  if (typeof detail === "string" && LEVEL.has(detail)) return "level";
  return "either";
}

/**
 * A ring cut to the tile's square, flat as x, y, x, y: what lies outside the
 * tile is the neighbour's to draw. Tiles carry their shapes a little past
 * their edge, and two tiles drawing the same strip of water would draw it
 * twice as strong, a seam along every tile edge. Up to `margin` past the
 * edge all round, for water.ts to close the seams with. Empty where nothing
 * of the ring is inside.
 */
export function clipRing(ring: readonly TilePoint[], extent: number, margin = 0): number[] {
  let points = ring.map(({ x, y }) => [x, y] as [number, number]);
  // The last point repeats the first in a tile's rings; the cut closes them itself.
  if (points.length > 1) {
    const [fx, fy] = points[0];
    const [lx, ly] = points[points.length - 1];
    if (fx === lx && fy === ly) points.pop();
  }
  // Sutherland–Hodgman, one edge of the square at a time.
  const edges: Array<[(point: [number, number]) => number, number]> = [
    [(p) => p[0], -margin], [(p) => -p[0], -extent - margin], [(p) => p[1], -margin], [(p) => -p[1], -extent - margin],
  ];
  for (const [along, at] of edges) {
    if (!points.length) break;
    const kept: Array<[number, number]> = [];
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const previous = points[(i + points.length - 1) % points.length];
      const inNow = along(current) >= at;
      const inBefore = along(previous) >= at;
      if (inNow !== inBefore) {
        const share = (at - along(previous)) / (along(current) - along(previous));
        kept.push([previous[0] + (current[0] - previous[0]) * share, previous[1] + (current[1] - previous[1]) * share]);
      }
      if (inNow) kept.push(current);
    }
    points = kept;
  }
  return points.length >= 3 ? points.flat() : [];
}

/** Twice a flat ring's area, signed by which way round it runs. */
export function ringArea(flat: readonly number[]): number {
  let sum = 0;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    sum += (flat[j] - flat[i]) * (flat[i + 1] + flat[j + 1]);
  }
  return sum;
}

/**
 * A tile's rings as polygons, each its outline and then its holes. In a
 * vector tile an outline runs one way round and a hole the other, and a
 * polygon's holes follow its outline; the first ring says which way is
 * which.
 */
export function polygonsOf(rings: readonly TilePoint[][]): TilePoint[][][] {
  const polygons: TilePoint[][][] = [];
  let outward = 0;
  for (const ring of rings) {
    const area = ringArea(ring.flatMap(({ x, y }) => [x, y]));
    if (area === 0) continue;
    if (!outward) outward = Math.sign(area);
    if (Math.sign(area) === outward || !polygons.length) polygons.push([ring]);
    else polygons[polygons.length - 1].push(ring);
  }
  return polygons;
}

/** One stretch of water in a tile, in triangles. */
export interface Piece {
  /** Its corners, x, y in the tile's units. */
  points: number[];
  /** Its triangles, three corners each. */
  triangles: number[];
  surface: Surface;
  /**
   * What it is a piece of, for the pieces of one lake in different tiles to
   * be put at one height: the feature's id where the tiles give one. Null
   * where they do not, or where its height is not one height.
   */
  lake: string | null;
}

/** A tile's water as pieces, each polygon cut to the tile and cut into triangles. */
export function piecesOf(features: Iterable<WaterFeature>, extent: number, withSea: boolean, margin = 0): Piece[] {
  const pieces: Piece[] = [];
  for (const feature of features) {
    const surface = surfaceOf(feature, withSea);
    if (!surface) continue;
    for (const polygon of polygonsOf(feature.loadGeometry())) {
      const outline = clipRing(polygon[0], extent, margin);
      if (!outline.length) continue;
      const points = outline.slice();
      const holes: number[] = [];
      for (const ring of polygon.slice(1)) {
        const hole = clipRing(ring, extent, margin);
        if (!hole.length) continue;
        holes.push(points.length / 2);
        points.push(...hole);
      }
      const triangles = earcut(points, holes.length ? holes : undefined, 2);
      if (!triangles.length) continue;
      const lake = surface !== "sloped" && feature.id !== undefined ? `${surface}:${feature.id}` : null;
      pieces.push({ points, triangles, surface, lake });
    }
  }
  return pieces;
}

/** How far apart the ground round water may lie and the water still be taken for level, metres as drawn. */
export const LEVEL_SPREAD_M = 15;

/** At most this many of a piece's corners and of its triangles' middles are measured for a level surface. */
const SAMPLES = 12;

/** `count` of `total` items, spread evenly through them. */
function spread(total: number, count: number): number[] {
  if (total <= count) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: count }, (_, index) => Math.floor(((index + 0.5) * total) / count));
}

/**
 * The heights a piece's surface is drawn at, each corner's, from `ground`
 * (the ground's height at a point of the tile, as drawn, or null where it is
 * not known yet). A level piece is one height, the lowest measured: where
 * the ground round still water is higher than the water, it is the shore,
 * and the water is no higher than the lowest of it. The sea is at 0.
 *
 * Returns the heights and, for a level piece, the one height, so that the
 * pieces of one lake can be put at the lowest of theirs.
 */
export function heightsOf(piece: Piece, ground: (x: number, y: number) => number | null): {
  heights: Float32Array;
  level: number | null;
} {
  const corners = piece.points.length / 2;
  const heights = new Float32Array(corners);
  if (piece.surface === "sea") return { heights, level: 0 };
  const at = (index: number) => ground(piece.points[index * 2], piece.points[index * 2 + 1]);
  if (piece.surface === "sloped") {
    for (let index = 0; index < corners; index += 1) heights[index] = at(index) ?? 0;
    return { heights, level: null };
  }
  const measured: number[] = [];
  for (const index of spread(corners, SAMPLES)) {
    const height = at(index);
    if (height !== null) measured.push(height);
  }
  // The middles of triangles: inside the water, where the ground is the water's own surface.
  const triangleCount = piece.triangles.length / 3;
  for (const triangle of spread(triangleCount, SAMPLES)) {
    const [a, b, c] = piece.triangles.slice(triangle * 3, triangle * 3 + 3);
    const x = (piece.points[a * 2] + piece.points[b * 2] + piece.points[c * 2]) / 3;
    const y = (piece.points[a * 2 + 1] + piece.points[b * 2 + 1] + piece.points[c * 2 + 1]) / 3;
    const height = ground(x, y);
    if (height !== null) measured.push(height);
  }
  if (!measured.length) return { heights, level: 0 };
  const low = Math.min(...measured);
  if (piece.surface === "either" && Math.max(...measured) - low > LEVEL_SPREAD_M) {
    for (let index = 0; index < corners; index += 1) heights[index] = at(index) ?? low;
    return { heights, level: null };
  }
  heights.fill(low);
  return { heights, level: low };
}
