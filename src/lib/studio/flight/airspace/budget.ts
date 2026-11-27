/**
 * How much of the other aircraft is drawn, and which: as much as the frame
 * rate allows, the nearest first.
 *
 * Each aircraft is one of three things, by how far it is: a model (near
 * enough for its shape to be seen), a silhouette (a few pixels of it), or
 * a light (past where it is more than a pixel, its strobe). How many of
 * each, of the contrails' segments, and of the aircraft whose fire is
 * drawn, follows the share of its full sharpness the flight is drawn at
 * (sharpness.ts), less on a phone or a tablet. What does not fit is drawn
 * as the next thing down, or not at all; the nearest always fit first.
 */

/** Out to here an aircraft is a model, and out to here a silhouette; from where lights fade in, metres. */
export const MODEL_M = 4500;
export const SILHOUETTE_M = 22_000;
export const LIGHT_FROM_M = 16_000;
/** The furthest a fire or a blast is drawn, metres. */
export const BURNING_M = 30_000;

export interface TrafficBudget {
  models: number;
  silhouettes: number;
  lights: number;
  /** Segments of contrail, all of them together. */
  trailSegments: number;
  /** Aircraft whose fire, smoke and blasts are drawn. */
  burning: number;
}

/** At full sharpness, and at the least, on a desk and in a hand. */
const DESK: [TrafficBudget, TrafficBudget] = [
  { models: 24, silhouettes: 64, lights: 400, trailSegments: 6144, burning: 4 },
  { models: 4, silhouettes: 16, lights: 120, trailSegments: 768, burning: 1 },
];
const HAND: [TrafficBudget, TrafficBudget] = [
  { models: 10, silhouettes: 32, lights: 240, trailSegments: 2048, burning: 2 },
  { models: 2, silhouettes: 8, lights: 64, trailSegments: 384, burning: 1 },
];

/** The budget at `quality` (0.1 to 1, `Sharpness.quality`), on a handheld or not. */
export function budgetFor(quality: number, handheld: boolean): TrafficBudget {
  const [most, least] = handheld ? HAND : DESK;
  const share = Math.min(Math.max((quality - 0.1) / 0.9, 0), 1);
  const at = (key: keyof TrafficBudget) => Math.round(least[key] + (most[key] - least[key]) * share);
  return { models: at("models"), silhouettes: at("silhouettes"), lights: at("lights"), trailSegments: at("trailSegments"), burning: at("burning") };
}

/** What an aircraft is drawn as. */
export const NOT_DRAWN = 0;
export const AS_MODEL = 1;
export const AS_SILHOUETTE = 2;
export const AS_LIGHT = 3;

export interface Chosen {
  models: number;
  silhouettes: number;
  lights: number;
}

/**
 * What each of `count` aircraft is drawn as, by `distance` (metres, null
 * or Infinity for one not to be drawn at all, `NaN` included), into
 * `kinds`; `order` is scratch of the same length, left holding them nearest
 * first. How many of each.
 */
export function choose(
  distance: Float64Array, count: number, budget: TrafficBudget, kinds: Uint8Array, order: Uint16Array,
): Chosen {
  for (let i = 0; i < count; i += 1) order[i] = i;
  const sorted = order.subarray(0, count);
  sorted.sort((a, b) => distance[a] - distance[b]);
  let models = 0;
  let silhouettes = 0;
  let lights = 0;
  for (let k = 0; k < count; k += 1) {
    const i = sorted[k];
    const d = distance[i];
    kinds[i] = NOT_DRAWN;
    if (!(d < Infinity)) continue;
    if (d < MODEL_M && models < budget.models) {
      kinds[i] = AS_MODEL;
      models += 1;
    } else if (d < SILHOUETTE_M && silhouettes < budget.silhouettes) {
      kinds[i] = AS_SILHOUETTE;
      silhouettes += 1;
    } else if (lights < budget.lights) {
      kinds[i] = AS_LIGHT;
      lights += 1;
    }
  }
  return { models, silhouettes, lights };
}

/**
 * A strobe's brightness at `seconds` on the page's clock, 0 to 1: a white
 * flash about once a second, each aircraft's at its own moment of it.
 */
export function strobe(seconds: number, own: number): number {
  const phase = seconds * 1.05 + own * 0.618;
  const f = phase - Math.floor(phase);
  // Two quick flashes, as an airliner's wing strobes give.
  return f < 0.05 ? 1 : f > 0.12 && f < 0.16 ? 0.8 : 0;
}
