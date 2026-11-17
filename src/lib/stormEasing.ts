/**
 * How the storm marks and the systems' outlines change from one drawing to
 * the next: eased and faded rather than snapped.
 *
 * Every new answer (live, about every five minutes) and every step of the
 * player redraws the storms. Drawn at once, a storm's mark jumps to where it
 * is now, storms pop in and out, and a system's outline is swapped for
 * another shape; a map that does that every few minutes reads as restless.
 * So a change is a short transition instead:
 *
 * - the same storm (by id) slides from where it was drawn to where it is, its
 *   path's newest point with it, unless it moved further than `EASE_MAX_KM`,
 *   which is no longer a storm moving: it fades out there and in here;
 * - a storm that appears fades in, one that goes fades out;
 * - a storm that changes how it is drawn (a quiet dot becoming a full mark, a
 *   new colour, a badge) cross-fades, the old look out and the new in, while
 *   both move;
 * - a system's outline with a new shape cross-fades, old out and new in.
 *
 * Identity is the id and nothing else: a different storm at nearly the same
 * place is a different storm, and fades rather than slides.
 *
 * ## Only When It Can Be Seen
 *
 * A transition is a few hundred milliseconds of redrawing the map, which a
 * phone pays for. A new answer or a new scan is eased; a step of the player
 * only when it comes more than `EASE_MIN_GAP_MS` after the step before it: a
 * single step, or the first of a drag. Playing the loop (a frame every
 * 450 ms) or dragging the slider steps faster than that, and those steps
 * apply at once, as they always did: the loop is already the motion, and a
 * drag wants the frame under the finger, not one catching up with it.
 *
 * When an update does arrive during a transition, it takes over from what is
 * drawn at that moment (`showing`): nothing is queued, and what was fading
 * out goes on fading out from where it was, or is gone if the update applies
 * at once. With `prefers-reduced-motion`, every change applies at once.
 *
 * Pure, and free of OpenLayers (StormManager drives it), so the rules can be
 * tested.
 */

/** How long a transition lasts, ms: a slide, a fade and a cross-fade alike. */
export const EASE_MS = 350;

/**
 * How far apart two drawings must be, ms, for the second to be eased: over
 * the player's 450 ms a frame, so a playing loop and a dragged slider snap.
 */
export const EASE_MIN_GAP_MS = 600;

/** How far a storm may move and still slide, km; further, and it fades out there and in here. */
export const EASE_MAX_KM = 25;

type LonLat = [number, number];

/** The geometries that are drawn, in [lon, lat]. */
export type Shape =
  | { type: "Point"; coordinates: LonLat }
  | { type: "LineString"; coordinates: LonLat[] }
  | { type: "Polygon"; coordinates: LonLat[][] }
  | { type: "MultiPolygon"; coordinates: LonLat[][][] };

/** One thing to draw: a storm's mark or a system's outline. */
export interface Drawn<T> {
  /** Its feature id, which is its identity: eased only into the same key. */
  key: string;
  /** Everything that decides how it looks; a change of look cross-fades. */
  look: string;
  /** Slides from one position to the next (a position or a path); anything else cross-fades when its shape changes. */
  moves: boolean;
  shape: Shape;
  /** What the caller draws it with. */
  value: T;
}

/** One thing in a transition, going from `from` at `fromAlpha` to `to` at `toAlpha`. */
export interface Easing<T> {
  /** Its feature id: the drawn one's key, or, for one fading out, a key of its own. */
  key: string;
  item: Drawn<T>;
  from: Shape;
  to: Shape;
  fromAlpha: number;
  toAlpha: number;
  /** Fading out for good: gone when the transition ends, and not tapped meanwhile. */
  leaving: boolean;
}

/** What is drawn at one moment of a transition. */
export interface Showing<T> {
  key: string;
  item: Drawn<T>;
  shape: Shape;
  alpha: number;
  leaving: boolean;
}

/**
 * Whether a change of drawing is eased, or applied at once.
 *
 * `stepGap` is for a step of the player: how long since the step before it,
 * ms, or undefined for a change that is not a step (a new answer, a new
 * scan), which is always eased. A first drawing appears at once.
 */
export function eases({ reducedMotion, drawnBefore, stepGap }: {
  reducedMotion: boolean;
  drawnBefore: boolean;
  stepGap?: number;
}): boolean {
  return !reducedMotion && drawnBefore && (stepGap === undefined || stepGap >= EASE_MIN_GAP_MS);
}

/** Fast at first, settling at the end: an update taking over mid-way moves at once. */
export const easeOut = (t: number): number => {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - clamped) ** 3;
};

/** Distance between two [lon, lat], km, flat-earth: these are a few tens of kilometres. */
export function kmBetween(a: LonLat, b: LonLat): number {
  const cos = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * cos, a[1] - b[1]) * 111.32;
}

const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The point a position or a path ends at: where its storm is. */
function endOf(shape: Shape): LonLat | null {
  if (shape.type === "Point") return shape.coordinates;
  if (shape.type === "LineString") return shape.coordinates[shape.coordinates.length - 1] ?? null;
  return null;
}

/** Whether `from` can slide into `to`: the same kind of mark, its end moved no further than `EASE_MAX_KM`. */
export function slides(from: Shape, to: Shape): boolean {
  if (from.type !== to.type || (from.type !== "Point" && from.type !== "LineString")) return false;
  const a = endOf(from);
  const b = endOf(to);
  return a !== null && b !== null && kmBetween(a, b) <= EASE_MAX_KM;
}

/** Whether two shapes are the same, coordinate for coordinate. */
export function sameShape(a: Shape, b: Shape): boolean {
  return a === b || (a.type === b.type && JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates));
}

/**
 * The shape `t` of the way (eased already) from `from` to `to`.
 *
 * A point slides. A path is the new path with its newest point sliding from
 * the old path's: a storm that moved on draws the old path with its newest
 * stretch growing to where the storm is now, the mark at its tip. Anything
 * else is the new shape; it does not move, it fades.
 */
export function shapeAt(from: Shape, to: Shape, t: number): Shape {
  if (t >= 1 || from === to) return to;
  if (from.type === "Point" && to.type === "Point") {
    return { type: "Point", coordinates: lerp(from.coordinates, to.coordinates, t) };
  }
  if (from.type === "LineString" && to.type === "LineString" && from.coordinates.length && to.coordinates.length) {
    const coordinates = to.coordinates.slice();
    const last = coordinates.length - 1;
    coordinates[last] = lerp(from.coordinates[from.coordinates.length - 1], to.coordinates[last], t);
    return { type: "LineString", coordinates };
  }
  return to;
}

/** A transition that ends at once: everything drawn as it is now, nothing leaving. */
export function settledOn<T>(next: readonly Drawn<T>[]): Easing<T>[] {
  return next.map((item) => ({
    key: item.key, item, from: item.shape, to: item.shape, fromAlpha: 1, toAlpha: 1, leaving: false,
  }));
}

/**
 * The transition from what is drawn now (`showing`, mid-transition or not)
 * to `next`.
 *
 * `seq` makes the keys of what starts leaving here its own: a storm that
 * cross-fades leaves under `${key}~${seq}` while its new look comes in under
 * its key.
 */
export function plan<T>(showing: readonly Showing<T>[], next: readonly Drawn<T>[], seq: number): Easing<T>[] {
  const current = new Map<string, Showing<T>>();
  for (const shown of showing) if (!shown.leaving) current.set(shown.key, shown);
  const easings: Easing<T>[] = [];
  const kept = new Set<string>();
  const leave = (shown: Showing<T>, to: Shape): Easing<T> => ({
    key: shown.leaving ? shown.key : `${shown.key}~${seq}`,
    item: shown.item,
    from: shown.shape,
    to,
    fromAlpha: shown.alpha,
    toAlpha: 0,
    leaving: true,
  });

  for (const item of next) {
    const was = current.get(item.key);
    const arrive = (from: Shape, alpha: number): Easing<T> => ({
      key: item.key, item, from, to: item.shape, fromAlpha: alpha, toAlpha: 1, leaving: false,
    });
    if (!was) {
      easings.push(arrive(item.shape, 0));
      continue;
    }
    kept.add(item.key);
    const unmoved = sameShape(was.shape, item.shape);
    const slide = !unmoved && item.moves && was.item.moves && slides(was.shape, item.shape);
    if (was.item.look === item.look) {
      if (unmoved || slide) {
        easings.push(arrive(was.shape, was.alpha));
      } else {
        // Too far, or a shape that does not slide: out there, in here.
        easings.push(leave(was, was.shape), arrive(item.shape, 0));
      }
      continue;
    }
    // A new look: the old one fades out as the new one fades in, moving together if it slides.
    if (unmoved || slide) easings.push(leave(was, item.shape), arrive(was.shape, 0));
    else easings.push(leave(was, was.shape), arrive(item.shape, 0));
  }

  // Gone, and whatever was already leaving: fading out from where it is.
  for (const shown of showing) {
    if (!shown.leaving && kept.has(shown.key)) continue;
    if (shown.alpha <= 0) continue;
    easings.push(leave(shown, shown.shape));
  }
  // What has not moved is not moved: the one shape, so nothing redraws it frame by frame.
  for (const easing of easings) if (easing.from !== easing.to && sameShape(easing.from, easing.to)) easing.from = easing.to;
  return easings;
}

/** What a transition draws `t` of the way through (0 to 1, not yet eased); at 1, what is left once it ends. */
export function showingAt<T>(easings: readonly Easing<T>[], t: number): Showing<T>[] {
  const e = easeOut(t);
  const showing: Showing<T>[] = [];
  for (const easing of easings) {
    const alpha = easing.fromAlpha + (easing.toAlpha - easing.fromAlpha) * e;
    if (easing.leaving && (t >= 1 || alpha <= 0)) continue;
    showing.push({
      key: easing.key,
      item: easing.item,
      shape: shapeAt(easing.from, easing.to, e),
      alpha: t >= 1 ? easing.toAlpha : alpha,
      leaving: easing.leaving,
    });
  }
  return showing;
}

/** Whether anything in a transition changes as it runs: one that does not is drawn once. */
export function animates<T>(easings: readonly Easing<T>[]): boolean {
  return easings.some((easing) => easing.fromAlpha !== easing.toAlpha || easing.from !== easing.to);
}
