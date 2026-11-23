/**
 * The cockpit's windows, and the light on the flight deck: what the weather
 * does to both.
 *
 * Water on the windshield comes with the rain, and with cloud warm enough to
 * be water; at an airliner's speed the air drives it off in seconds, and
 * standing it runs off and dries over a minute. In a storm's cloud, where
 * ice and water meet and the air is charged, the glass crawls with St Elmo's
 * fire, and more of it the nearer the lightning. Cloud takes the sun off the
 * flight deck, a storm overhead much of the sky's light too, and a strike
 * nearby lights all of it for a moment.
 *
 * The numbers are worked out here; the glass is drawn by the aircraft's
 * renderer (layers/aircraftRenderer.ts), on the model's own windows.
 */
import { VERTEX_BYTES } from "./model";
import type { AircraftModel } from "./model";

const ramp = (value: number, low: number, high: number) => Math.min(Math.max((value - low) / (high - low), 0), 1);

/** The echo as a number: none at all for no echo, or none the radar could give. */
const echoOf = (dbz: number | null) => (dbz === null || dbz === -Infinity ? -30 : dbz);

/** What the air round the aircraft puts on its windows. */
export interface GlassAir {
  /** Rain and cloud going past, 0 to 1 each (weather.ts's `Air`). */
  rain: number;
  cloud: number;
  /** The air's temperature, degrees C. */
  temperature: number;
  /** The true airspeed, m/s: what drives water off the glass. */
  tas: number;
}

/** How long water takes to come on the glass in rain, seconds. */
const WETTING_S = 0.8;
/** How long it takes to go once out of the rain: blown off at speed, and run off and dried standing, seconds. */
const BLOWN_OFF_S = 2;
const DRIED_S = 50;

/**
 * How wet the windshield is, 0 to 1, `dt` seconds on from `wet` in this air.
 * Below freezing what strikes it is ice, not water: grown in from each
 * window's edges (`windowPanes`).
 */
export function wetted(wet: number, air: GlassAir, dt: number): number {
  const liquid = ramp(air.temperature, -4, 1);
  const target = Math.min(1, Math.max(air.rain, 0.45 * air.cloud) * liquid);
  const pace = target >= wet ? WETTING_S : BLOWN_OFF_S + (DRIED_S - BLOWN_OFF_S) * (1 - ramp(air.tas, 10, 80));
  return wet + (target - wet) * (1 - Math.exp(-Math.max(dt, 0) / pace));
}

/**
 * How charged the air round the aircraft is, 0 to 1: how much St Elmo's fire
 * there is on the glass. It takes cloud with a strong echo in it, more where
 * it is cold enough for ice and water to meet (graupel rubbing past is what
 * charges a storm), and more again with lightning nearby (`flash`, its glare
 * on the glass, lightning.ts).
 */
export function chargeOf(air: { cloud: number; dbz: number | null; temperature: number }, flash = 0): number {
  const mixed = ramp(-air.temperature, -6, 4);
  const storm = ramp(echoOf(air.dbz), 36, 52) * (0.35 + 0.65 * mixed);
  return Math.min(1, air.cloud * (storm + 0.6 * flash));
}

/**
 * The light on the flight deck, 0 to 1 each: how much of the sun reaches
 * it, and how light the sky round it is. In cloud the sun is gone and the
 * sky a flat grey; under a storm, in or out of its cloud, the heavier the
 * echo the darker it is.
 */
export function daylightOf(cloud: number, dbz: number | null): { sun: number; sky: number } {
  const storm = ramp(echoOf(dbz), 28, 55);
  return { sun: (1 - 0.92 * cloud) * (1 - 0.75 * storm), sky: 1 - 0.25 * cloud - 0.4 * storm };
}

/**
 * Cloud's colour as the sky lights it (`sky` from `daylightOf`, 0 to 1): near
 * white in daylight, a storm's grey where it is dark. Cloud round the eye and
 * an aircraft going from sight in it are this one colour, or the aircraft
 * shows brighter than the cloud it is in.
 */
export function cloudColour(sky = 1): [number, number, number] {
  const light = 0.4 + 0.6 * Math.min(Math.max(sky, 0), 1);
  return [0.86 * light, 0.89 * light, 0.92 * light];
}

type Vec3 = [number, number, number];

/**
 * A window of the cockpit, in the model's own metres: what ice on it grows
 * in from, so it is on that pane and moves with it, not with the eye.
 */
export interface WindowPane {
  /** Its plane: a unit normal and how far along it the plane is; and its middle. */
  plane: [number, number, number, number];
  middle: Vec3;
  /**
   * Its edges, round it: each an outward unit normal in its plane and how far
   * along that the edge is, so a point of the pane is `offset - normal · point`
   * in from it.
   */
  edges: Array<[number, number, number, number]>;
  /** How far in from its edges its middle is, metres. */
  depth: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/**
 * The cockpit's windows, from the model's see-through meshes (each piece of
 * one that is joined up is a pane): taken as flat, and as the outline round
 * them, which is what a window's frame is.
 */
export function windowPanes(model: AircraftModel): WindowPane[] {
  const panes: WindowPane[] = [];
  for (const chunk of model.chunks) {
    if (chunk.part || (model.materials[chunk.material]?.opacity ?? 1) >= 1) continue;
    const bytes = new DataView(chunk.vertices.buffer, chunk.vertices.byteOffset, chunk.vertices.byteLength);
    const count = chunk.vertices.byteLength / VERTEX_BYTES;
    const places = Array.from({ length: count }, (_, i): Vec3 => {
      const at = (axis: number) => (bytes.getUint16(i * VERTEX_BYTES + axis * 2, true) / 65535) * chunk.size[axis] + chunk.min[axis];
      return [at(0), at(1), at(2)];
    });
    // Which vertices are joined, by the triangles between them.
    const root = Array.from({ length: count }, (_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    const { indices } = chunk;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      root[find(indices[t + 1])] = find(indices[t]);
      root[find(indices[t + 2])] = find(indices[t]);
    }
    const facing = new Map<number, Vec3>();
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const [a, b, c] = [places[indices[t]], places[indices[t + 1]], places[indices[t + 2]]];
      const area = cross(sub(b, a), sub(c, a));
      const pane = find(indices[t]);
      const sum = facing.get(pane) ?? [0, 0, 0];
      // Turned one way, whichever way the triangle is wound.
      const sign = dot(area, sum) < 0 ? -1 : 1;
      facing.set(pane, [sum[0] + sign * area[0], sum[1] + sign * area[1], sum[2] + sign * area[2]]);
    }
    for (const [pane, sum] of facing) {
      const points = places.filter((_, i) => find(i) === pane);
      if (points.length < 3 || Math.hypot(...sum) < 1e-9) continue;
      const normal = unit(sum);
      const middle = points.reduce((all, p) => [all[0] + p[0] / points.length, all[1] + p[1] / points.length, all[2] + p[2] / points.length] as Vec3, [0, 0, 0] as Vec3);
      // Two ways across the pane, and its outline in them.
      const across = unit(cross(normal, Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const up = cross(normal, across);
      const outline = hull(points.map((p) => [dot(sub(p, middle), across), dot(sub(p, middle), up)] as [number, number]));
      if (outline.length < 3) continue;
      const edges2d = outline.map((from, i) => {
        const to = outline[(i + 1) % outline.length];
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
        // Round it the way the hull goes (anticlockwise), out is to the right.
        const out: [number, number] = [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
        return { out, offset: out[0] * from[0] + out[1] * from[1] };
      });
      const inFrom = (x: number, y: number) => Math.min(...edges2d.map(({ out, offset }) => offset - out[0] * x - out[1] * y));
      // How deep the pane is: the furthest any point of it is from its edges, looked for over a grid.
      const xs = outline.map((p) => p[0]);
      const ys = outline.map((p) => p[1]);
      let depth = 0;
      for (let i = 0; i <= 32; i += 1) {
        for (let j = 0; j <= 32; j += 1) {
          const x = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 32;
          const y = Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 32;
          depth = Math.max(depth, inFrom(x, y));
        }
      }
      if (depth <= 1e-4) continue;
      panes.push({
        plane: [...normal, dot(normal, middle)],
        middle,
        edges: edges2d.map(({ out, offset }) => {
          const outward: Vec3 = [across[0] * out[0] + up[0] * out[1], across[1] * out[0] + up[1] * out[1], across[2] * out[0] + up[2] * out[1]];
          return [...outward, offset + dot(outward, middle)];
        }),
        depth,
      });
    }
  }
  return panes;
}

/** The convex outline round points, anticlockwise, with no point twice or in a straight run. */
function hull(points: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Array<[number, number]>) => {
    const out: Array<[number, number]> = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
