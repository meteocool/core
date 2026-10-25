/**
 * A wind barb, the meteorological way, as shapes in pixel space.
 *
 * The station is at the origin, x to the right and y down, as a canvas has
 * it. The shaft points from the station towards where the wind comes from.
 * Its feathers sit at the far end, on the shaft's right when looking along it
 * from the station: that is the Northern Hemisphere's side, so a westerly's
 * stand up towards the north, the low pressure side. A pennant is 50 kt, a
 * full feather 10 and a half one 5, after rounding the speed to the nearest
 * 5 kt; pennants come first from the end, then full feathers, then the half.
 * Below 2.5 kt it is calm: an open circle and no shaft.
 *
 * Pure: the station layer (layers/stations.ts) draws what this returns.
 */

/** Knots in one metre per second. */
export const KNOTS_PER_M_S = 1.943844;

export type Point = [number, number];
export type Segment = [Point, Point];
export type Triangle = [Point, Point, Point];

export type BarbShape =
  | { kind: "calm"; radius: number }
  | { kind: "barb"; knots: number; shaft: Segment; feathers: Segment[]; pennants: Triangle[] };

/** How big a barb is drawn, in CSS pixels. */
export interface BarbSize {
  /** The shaft, when the feathers fit on it; longer when they do not. */
  shaft: number;
  /** A full feather, and how far a pennant stands off the shaft. */
  feather: number;
  /** Between two feathers along the shaft. */
  step: number;
  /** A pennant's base along the shaft. */
  pennant: number;
  /** The calm circle. */
  calm: number;
}

export const BARB_SIZE: BarbSize = { shaft: 26, feather: 12, step: 4.5, pennant: 6, calm: 5 };

/**
 * How far a feather's tip leans out towards the shaft's end, as a share of
 * its length: the usual sixty-odd degrees off the shaft.
 */
const LEAN = 0.45;

export function toKnots(metresPerSecond: number): number {
  return metresPerSecond * KNOTS_PER_M_S;
}

/** The speed a barb is drawn for: the nearest 5 kt. */
export function roundKnots(knots: number): number {
  return Math.max(0, Math.round(knots / 5) * 5);
}

/** The barb for a speed in knots and the direction the wind comes from, in degrees from north. */
export function windBarb(knots: number, fromDeg: number, size: BarbSize = BARB_SIZE): BarbShape {
  const rounded = roundKnots(knots);
  if (rounded < 2.5) return { kind: "calm", radius: size.calm };

  const pennants = Math.floor(rounded / 50);
  const fulls = Math.floor((rounded % 50) / 10);
  const half = rounded % 10 >= 5;

  // Along the shaft, from the station out, and its right-hand side.
  const theta = (fromDeg * Math.PI) / 180;
  const along: Point = [Math.sin(theta), -Math.cos(theta)];
  const right: Point = [-along[1], along[0]];

  // Where each mark starts, measured in from the far end. A lone half
  // feather sits one step in, so it is not read as a full one cut short.
  let cursor = pennants === 0 && fulls === 0 ? size.step : 0;
  const pennantAt: number[] = [];
  for (let i = 0; i < pennants; i++) {
    pennantAt.push(cursor);
    cursor += size.pennant;
  }
  if (pennants > 0 && (fulls > 0 || half)) cursor += size.step / 2;
  const featherAt: { from: number; length: number }[] = [];
  for (let i = 0; i < fulls; i++) {
    featherAt.push({ from: cursor, length: size.feather });
    cursor += size.step;
  }
  if (half) {
    featherAt.push({ from: cursor, length: size.feather / 2 });
    cursor += size.step;
  }

  // A shaft long enough for all of them, with a step clear of the station.
  const length = Math.max(size.shaft, cursor + size.step * 2);
  const on = (inFromEnd: number): Point => [along[0] * (length - inFromEnd), along[1] * (length - inFromEnd)];
  const out = (from: Point, sideways: number, outwards: number): Point => [
    from[0] + right[0] * sideways + along[0] * outwards,
    from[1] + right[1] * sideways + along[1] * outwards,
  ];

  return {
    kind: "barb",
    knots: rounded,
    shaft: [[0, 0], on(0)],
    pennants: pennantAt.map((at) => [on(at), on(at + size.pennant), out(on(at), size.feather, 0)]),
    feathers: featherAt.map(({ from, length: feather }) => [on(from), out(on(from), feather, feather * LEAN)]),
  };
}
