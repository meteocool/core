/**
 * The weather where the aircraft is: what the radar measured there, and what
 * flying through it feels like.
 *
 * Read from the volumes the map holds, voxel by voxel, at the aircraft's
 * true position and height. So the cloud it whites out in, the rain on the
 * windshield and the bumps are the storms on the screen, measured, not
 * scenery: a box drawn as a tower of cloud is a box the aircraft shakes in.
 */
import type { Cutaway } from "../../cellCutaway";
import { offsetM } from "./geo";

/**
 * The reflectivity at a point, dBZ, from the held volumes that hold it: the
 * strongest where two overlap (a tile's apron is its neighbour's ground).
 * Null where none of them reaches; air a volume holds with no echo in it,
 * or none the radars saw, reads as no echo at all, -Infinity.
 *
 * Placed as the map draws a box (lib/volumeBox.ts, the storm layer): its
 * middle on its header's point, its floor at sea level.
 */
export function reflectivityAt(
  cutaways: Iterable<Pick<Cutaway, "header" | "voxels" | "extentM">>, lon: number, lat: number, altitude: number,
): number | null {
  let found: number | null = null;
  for (const { header, voxels, extentM } of cutaways) {
    if (altitude < 0 || altitude >= extentM[2]) continue;
    const [east, north] = offsetM(header.lon, header.lat, lon, lat);
    const fx = (east + extentM[0] / 2) / header.step_m[0];
    const fy = (north + extentM[1] / 2) / header.step_m[1];
    const fz = altitude / header.step_m[2];
    if (fx < 0 || fy < 0 || fx >= header.nx || fy >= header.ny || fz >= header.nz) continue;
    const at = ((Math.floor(fz) * header.ny + Math.floor(fy)) * header.nx + Math.floor(fx)) * 2;
    const byte = voxels[at];
    const seen = voxels[at + 1];
    const dbz = byte === 0 || seen === 0 ? -Infinity : byte / header.dbz_scale + header.dbz_floor;
    if (found === null || dbz > found) found = dbz;
  }
  return found;
}

const ramp = (value: number, low: number, high: number) => Math.min(Math.max((value - low) / (high - low), 0), 1);

/**
 * How rough the air is, 0 to 1: nothing below 15 dBZ, light chop in
 * moderate rain, and strong from 50 dBZ, where a convective core's up- and
 * downdrafts are.
 */
export function turbulenceOf(dbz: number | null): number {
  if (dbz === null) return 0;
  return ramp(dbz, 15, 50) ** 1.5;
}

/** How thick the cloud is around the aircraft, 0 to 1: from where the white cloud is drawn up. */
export function cloudOf(dbz: number | null): number {
  if (dbz === null) return 0;
  return ramp(dbz, 17, 32);
}

/** How hard it rains on the windshield, 0 to 1: from 30 dBZ up. */
export function rainOf(dbz: number | null): number {
  if (dbz === null) return 0;
  return ramp(dbz, 30, 50);
}

/**
 * Smooth noise in about -1 to 1, as a function of time: a few sines at
 * frequencies that never line up, so it does not repeat in any stretch a
 * flight lasts. Deterministic, for the tests.
 */
export function noise(t: number, seed = 0): number {
  return (Math.sin(t * 1.31 + seed * 3.7) * 0.5
    + Math.sin(t * 2.97 + seed * 1.9 + 1.2) * 0.3
    + Math.sin(t * 7.13 + seed * 5.3 + 2.7) * 0.2);
}

/**
 * The gust a turbulence feels like at a moment: degrees a second of roll
 * and pitch and m/s up and down, scaled by `turbulence`.
 */
export function gustAt(t: number, turbulence: number): { roll: number; pitch: number; vertical: number } {
  if (turbulence <= 0) return { roll: 0, pitch: 0, vertical: 0 };
  return {
    roll: noise(t, 1) * 9 * turbulence,
    pitch: noise(t, 2) * 3 * turbulence,
    vertical: noise(t * 0.7, 3) * 9 * turbulence,
  };
}

/* ---- The air round the aircraft ---- */

/** The echo a storm's core is taken to begin at, and the one where it is as bad as it gets, dBZ. */
export const CORE_DBZ = [47, 62];
/** How much stronger the draughts of the worst core are than the echo alone would make them. */
const CORE_DRAFT = 0.8;
/**
 * What the worst core adds to the gusts: to the roll a slow lean that
 * takes a wing a long way down, a heave and a slam, degrees a second; to
 * the pitch a heave and a slam; to the air's rise and fall a heave, a chop
 * and a slam, m/s.
 */
const CORE_GUST = { roll: [16, 14, 36], pitch: [3, 7], vertical: [10, 8, 34] } as const;

/** How far round the aircraft the radar's field is read for what the air is doing, metres across and up. */
export const AIR_REACH_M = { across: 1800, up: 1000 };

/** Where water freezes in a standard atmosphere, metres, and how fast it cools with height, degrees a kilometre. */
const LAPSE_PER_KM = 6.5;

/**
 * The air's temperature at a height, degrees C: a standard atmosphere,
 * shifted by how much warmer or colder than standard the ground is where a
 * station says (`offset`).
 */
export function temperatureAt(altitude: number, offset = 0): number {
  return 15 + offset - LAPSE_PER_KM * Math.min(altitude, 11_000) / 1000;
}

/** What the air is doing to an aircraft at a place, and what is in it. */
export interface Air {
  /** The echo at the aircraft, dBZ; null where the radar has none to give. */
  dbz: number | null;
  /** How rough, 0 to 1: all of it from a strong echo up. */
  turbulence: number;
  /** How much rougher than that again, 0 to 1: nothing short of a storm's core, all of it in the heaviest. */
  severity: number;
  /** How fast the air itself rises (or, negative, sinks), m/s. */
  draft: number;
  /** What goes past the windows, 0 to 1 each: cloud, rain, hail, ice crystals. */
  cloud: number;
  rain: number;
  hail: number;
  ice: number;
  /** How fast ice builds on the airframe, 0 to 1: in cloud, a little below freezing. */
  icing: number;
  /** The air's temperature, degrees C. */
  temperature: number;
}

/**
 * The air at the aircraft, from the echo there and round it. `echo` reads
 * the radar's field so many metres east, north and up of the aircraft.
 *
 * What a radar's echo says about the air is assumed, as follows.
 * - Rough air goes with strong echo, and more with echo that changes over a
 *   short way: the edge of a core, where air going up meets air coming
 *   down, is rougher than its middle.
 * - A core is another thing again. From about 50 dBZ the air is severe, and
 *   in the heaviest echo there is, 60 dBZ and over, extreme: gusts with
 *   edges to them that an airframe flown fast into them is not built for,
 *   which is why nobody flies into one. The edge of such a core is no
 *   better than its middle.
 * - Strong echo held up high is a storm still growing, and the air in it is
 *   going up; strong echo low down is rain falling, and drags the air down
 *   with it. Both by more the stronger the echo, and in a core by nearly as
 *   much again.
 * - Echo is cloud from where a white cloud is drawn, rain where it is warm,
 *   ice where it is well below freezing, a mix between; hail from where a
 *   core is strong enough to make it.
 * - Ice builds on the aircraft in cloud between freezing and twenty below,
 *   where the droplets are still liquid.
 */
export function airAt(
  echo: (east: number, north: number, up: number) => number | null, altitude: number, baseM: number, temperatureOffset = 0,
): Air {
  const at = (value: number | null) => (value === null || value === -Infinity ? -30 : value);
  const dbz = echo(0, 0, 0);
  const here = at(dbz);
  const { across, up } = AIR_REACH_M;
  const round = [echo(across, 0, 0), echo(-across, 0, 0), echo(0, across, 0), echo(0, -across, 0)].map(at);
  const [above, below] = [at(echo(0, 0, up)), at(echo(0, 0, -up))];
  // How fast the echo changes, dBZ a kilometre: the larger of across and up.
  const shear = Math.max(
    Math.hypot(round[0] - round[1], round[2] - round[3]) / ((2 * across) / 1000),
    Math.abs(above - below) / ((2 * up) / 1000),
  );
  // Near a storm the air is rough before the echo begins.
  const near = Math.max(here, ...round, above, below);
  const turbulence = Math.min(1, Math.max(
    ramp(here, 15, 50) ** 1.5,
    0.75 * ramp(shear, 2, 9) * ramp(near, 20, 40),
    0.18 * ramp(near, 30, 50),
  ));
  const severity = Math.max(ramp(here, CORE_DBZ[0], CORE_DBZ[1]), 0.6 * ramp(shear, 4, 10) * ramp(near, 52, CORE_DBZ[1]));
  const temperature = temperatureAt(altitude, temperatureOffset);
  // Going up where a strong echo is held aloft in the cold, coming down where it rains hard.
  const rising = ramp(here, 34, 60) * ramp(-temperature, -2, 12) * 22 * (1 + CORE_DRAFT * severity);
  const sinking = ramp(here, 38, 58) * ramp(temperature, -4, 8) * ramp(baseM + 800 - altitude, 0, 1500) * 14 * (1 + CORE_DRAFT * severity);
  const cloud = altitude >= baseM - 150 ? ramp(here, 7, 26) : 0;
  const wet = ramp(here, 24, 48);
  const frozen = ramp(-temperature, 2, 14);
  return {
    dbz,
    turbulence,
    severity,
    draft: rising - sinking,
    cloud,
    rain: wet * (1 - frozen),
    hail: ramp(here, 53, 62),
    ice: Math.max(cloud * 0.5, wet) * frozen,
    icing: cloud * ramp(-temperature, 0, 3) * (1 - ramp(-temperature, 16, 24)),
    temperature,
  };
}

/**
 * The gusts of rough air at a moment: degrees a second of roll and pitch,
 * and m/s up and down. A slow heave that lifts and drops the aircraft, a
 * faster chop on top of it, and now and then a jolt; with `draft`, the air's
 * own rise or fall, which is steady only in that it wanders slowly.
 *
 * With `severity`, a storm's core on top of all that: the air there is
 * columns going up beside columns coming down, and flying from one into
 * the next is a wall. Larger heaves, a hard fast chop, and slams with
 * edges to them that throw a wing up and the nose with it.
 */
export function roughAir(t: number, turbulence: number, draft = 0, severity = 0): { roll: number; pitch: number; vertical: number } {
  // The draft is not one column of air: it comes and goes over some seconds.
  const steady = draft * (0.65 + 0.35 * noise(t * 0.23, 9));
  if (turbulence <= 0) return { roll: 0, pitch: 0, vertical: steady };
  // A jolt: the sharp peaks of a noise, cubed, so most of the time there is none.
  const jolt = noise(t * 3.1, 7) ** 3;
  const core = Math.max(0, severity) * turbulence;
  // A slam: the same, faster and so sharper, and from another noise, so the two do not come together.
  const slam = core > 0 ? noise(t * 4.9, 13) ** 3 : 0;
  return {
    roll: (noise(t, 1) * 8 + noise(t * 4.3, 4) * 5 + jolt * 14) * turbulence
      + (noise(t * 0.37, 15) * CORE_GUST.roll[0] + noise(t * 1.7, 10) * CORE_GUST.roll[1] + slam * CORE_GUST.roll[2]) * core,
    pitch: (noise(t, 2) * 2.6 + noise(t * 3.7, 5) * 1.8 + jolt * 5) * turbulence
      + (noise(t * 2.3, 11) * CORE_GUST.pitch[0] + slam * CORE_GUST.pitch[1]) * core,
    vertical: steady + (noise(t * 0.7, 3) * 8 + noise(t * 3.3, 6) * 4 + jolt * 16) * turbulence * turbulence
      + (noise(t * 1.9, 12) * CORE_GUST.vertical[0] + noise(t * 5.3, 14) * CORE_GUST.vertical[1] + slam * CORE_GUST.vertical[2]) * core,
  };
}
