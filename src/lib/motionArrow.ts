/**
 * The rain's motion as an arrow, the shapes in pixel space.
 *
 * Each arrow the server sends stands for a block of the map and carries the
 * block's mean motion, km/h east and north (ng's ADR 0042). The arrow is
 * centred on the block's middle and points the way the rain goes. A faster
 * motion is a longer arrow, from `ARROW_SIZE.shortest` at `STILL_KMH` to
 * `ARROW_SIZE.longest` at `FASTEST_KMH` and beyond; below `STILL_KMH` there is
 * no arrow, since a few km/h of jitter would point anywhere.
 *
 * Speeds are kept to the nearest 5 km/h and directions to the nearest 5
 * degrees, so a map of a thousand arrows is drawn from a few dozen shapes.
 *
 * x is to the right and y down, as a canvas has it. Pure: the arrow layer
 * (layers/motionArrows.ts) draws what this returns.
 */

export type Point = [number, number];
export type Segment = [Point, Point];
export type Triangle = [Point, Point, Point];

export interface ArrowShape {
  /** km/h, to the nearest 5. */
  kmh: number;
  /** Where the rain goes, degrees clockwise from north, to the nearest 5. */
  towardDeg: number;
  /** From the tail to where the head begins. */
  shaft: Segment;
  /** The head: its tip, then its two barbs. */
  head: Triangle;
}

/** How big an arrow is drawn, in CSS pixels. */
export interface ArrowSize {
  shortest: number;
  longest: number;
  /** The head's length along the shaft, and its half width. */
  head: number;
  halfWidth: number;
}

/* The tile set puts arrows about 56 pixels apart at the zoom of their tiles
   (layers/motionArrows.ts): the longest leaves a third of that between two. */
export const ARROW_SIZE: ArrowSize = { shortest: 10, longest: 34, head: 6.5, halfWidth: 4 };

/** Slower than this is no arrow. */
export const STILL_KMH = 5;
/** As fast as this, or faster, is the longest arrow. */
export const FASTEST_KMH = 100;

/** Speed in km/h and direction of travel, degrees clockwise from north, of a motion east and north. */
export function motionOf(eastKmh: number, northKmh: number): { kmh: number; towardDeg: number } {
  const kmh = Math.hypot(eastKmh, northKmh);
  const towardDeg = ((Math.atan2(eastKmh, northKmh) * 180) / Math.PI + 360) % 360;
  return { kmh, towardDeg };
}

/** The speed an arrow is drawn for: the nearest 5 km/h. */
export function roundKmh(kmh: number): number {
  return Math.max(0, Math.round(kmh / 5) * 5);
}

/** The direction an arrow is drawn for: the nearest 5 degrees, 0 to 355. */
export function roundDeg(deg: number): number {
  return (((Math.round(deg / 5) * 5) % 360) + 360) % 360;
}

/** How long an arrow is for a speed, tail to tip. */
export function arrowLength(kmh: number, size: ArrowSize = ARROW_SIZE): number {
  const share = Math.min(Math.max((kmh - STILL_KMH) / (FASTEST_KMH - STILL_KMH), 0), 1);
  return size.shortest + share * (size.longest - size.shortest);
}

/** The arrow for a motion east and north in km/h; null when it is too slow to have a direction. */
export function motionArrow(eastKmh: number, northKmh: number, size: ArrowSize = ARROW_SIZE): ArrowShape | null {
  const motion = motionOf(eastKmh, northKmh);
  const kmh = roundKmh(motion.kmh);
  if (kmh < STILL_KMH) return null;
  const towardDeg = roundDeg(motion.towardDeg);
  const theta = (towardDeg * Math.PI) / 180;
  // Along the arrow, tail to tip, in canvas pixels (y down), and its right.
  const along: Point = [Math.sin(theta), -Math.cos(theta)];
  const right: Point = [-along[1], along[0]];
  const half = arrowLength(kmh, size) / 2;
  const at = (distance: number, aside = 0): Point => [
    along[0] * distance + right[0] * aside,
    along[1] * distance + right[1] * aside,
  ];
  const neck = half - size.head;
  return {
    kmh,
    towardDeg,
    shaft: [at(-half), at(neck)],
    head: [at(half), at(neck, size.halfWidth), at(neck, -size.halfWidth)],
  };
}

/** How much older than the arrows an observed frame may be before they are no longer its motion. */
export const STALE_AFTER_S = 15 * 60;

/**
 * Whether the arrows, which are the newest motion, are not the motion of the
 * frame the timeline shows: an observed frame well before them. A forecast
 * frame is not: the forecast is the rain moved along the newest motion.
 */
export function arrowsStale(frameS: number | null, arrowsS: number | null, onForecast: boolean): boolean {
  if (frameS === null || arrowsS === null || onForecast) return false;
  return arrowsS - frameS > STALE_AFTER_S;
}
