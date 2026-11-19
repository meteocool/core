/**
 * Lightning, as a flight sees it: where a strike is, a bolt drawn from the
 * cloud to the ground, and how bright both are from one moment to the next.
 *
 * The strikes are real where the map has them (it draws the same ones as
 * dots). A real flash is a few strokes down one channel within half a
 * second, which is why lightning flickers; a bolt here is that channel,
 * jagged, with a branch or two that end in the air.
 *
 * Everything is worked out from a strike's own number, so the same strike
 * is the same bolt on every frame and in every test.
 */
import type { Vec3 } from "./view";

/** How long a flash lasts, seconds. */
export const FLASH_S = 0.62;

/** When each stroke of a flash comes, seconds into it, and how bright it is against the first. */
const STROKES: ReadonlyArray<[number, number]> = [[0, 1], [0.07, 0.55], [0.15, 0.8], [0.29, 0.4], [0.41, 0.25]];
/** How fast a stroke dies away, seconds. */
const STROKE_S = 0.045;

/** How bright a flash is `age` seconds after it began, 0 to 1: each stroke at once, then dying away. */
export function flicker(age: number): number {
  if (age < 0 || age > FLASH_S) return 0;
  let brightness = 0;
  for (const [at, strength] of STROKES) {
    if (age >= at) brightness = Math.max(brightness, strength * Math.exp(-(age - at) / STROKE_S));
  }
  return brightness;
}

/** A number from 0 to 1 made from two others, the same every time. */
function chance(seed: number, n: number): number {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A bolt from `top` metres up to the ground: its channel and its branches,
 * each a line of points as metres east, north and up of where it strikes.
 * The channel wanders sideways as it comes down and ends on the spot; a
 * branch leaves it part of the way down and stops short of the ground.
 */
export function boltPaths(seed: number, top: number): Vec3[][] {
  const steps = 14;
  const channel: Vec3[] = [];
  let east = (chance(seed, 1) - 0.5) * top * 0.5;
  let north = (chance(seed, 2) - 0.5) * top * 0.5;
  for (let i = 0; i <= steps; i += 1) {
    const share = i / steps;
    // Sideways by a few hundred metres a step, and drawn in to the strike as it nears the ground.
    east = east * (1 - share * 0.35) + (chance(seed, 10 + i) - 0.5) * top * 0.12;
    north = north * (1 - share * 0.35) + (chance(seed, 40 + i) - 0.5) * top * 0.12;
    channel.push(i === steps ? [0, 0, 0] : [east * (1 - share), north * (1 - share), top * (1 - share)]);
  }
  const paths = [channel];
  const branches = 1 + Math.floor(chance(seed, 3) * 3);
  for (let b = 0; b < branches; b += 1) {
    const from = 2 + Math.floor(chance(seed, 70 + b) * (steps - 6));
    const branch: Vec3[] = [channel[from]];
    let [x, y, z] = channel[from];
    const [dx, dy] = [(chance(seed, 80 + b) - 0.5) * top * 0.22, (chance(seed, 90 + b) - 0.5) * top * 0.22];
    for (let i = 1; i <= 4; i += 1) {
      x += dx * (0.6 + chance(seed, 100 + b * 7 + i) * 0.8);
      y += dy * (0.6 + chance(seed, 130 + b * 7 + i) * 0.8);
      z -= top * 0.05 * (0.5 + chance(seed, 160 + b * 7 + i));
      branch.push([x, y, Math.max(z, top * 0.08)]);
    }
    paths.push(branch);
  }
  return paths;
}

/**
 * How bright a flash is on the glass, 0 to 1, from how far off it is,
 * metres: one overhead lights the whole cockpit, one a dozen kilometres away
 * the sky only.
 */
export function glare(distance: number): number {
  return Math.max(0, 1 - distance / 12_000) ** 2;
}

/** How long thunder takes to arrive from so far, seconds. */
export const thunderDelay = (distance: number): number => distance / 343;
