/**
 * Where a flight starts: which storm system it flies at, and from where.
 *
 * The listed volumes are every tile of sky it rains in, across every
 * network. Grouped by adjacency they are storm systems, and the best one to
 * fly at is heavy, full of lightning, near mountains (the relief is half of
 * what a flight among storms shows) and near where the reader was looking in
 * Studio, so a storm the reader has framed wins over a stronger one a
 * continent away.
 *
 * The aircraft starts in the air some way short of the system, nose on it:
 * from the side where the way in crosses high ground, where no other storm
 * stands on the start, and with the sun behind, so the towers ahead are lit.
 */
import { bearingDeg, destination, distanceM, offsetM, wrap180, wrap360 } from "./geo";

/** A listed volume, as much of one as this needs. */
export interface StormTile {
  lon: number;
  lat: number;
  peakDbz: number | null;
  areaKm2: number | null;
  coarse: boolean;
  /** The map tile it fills, z, x, y; null for a volume from before tiles. */
  tile: readonly number[] | null;
}

/** Storms grouped: where, how strong, how large. */
export interface StormSystem {
  lon: number;
  lat: number;
  /** From the middle to its furthest tile's edge, km. */
  radiusKm: number;
  peakDbz: number;
  strength: number;
  /** Lightning strikes in it lately (`withStrikes`); 0 where none were counted. */
  strikes: number;
  tiles: number;
  /** Where its tiles stand and how wide each is, for finding its edge on a way in: east and north of its middle, km. */
  extent: ReadonlyArray<{ east: number; north: number; half: number }>;
}

/** Where the aircraft starts and what it flies at; `target` null where the radar has no weather. */
export interface Approach {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  target: StormSystem | null;
}

/**
 * Mountain ranges, as boxes west, south, east, north, each with how much a
 * flight gains from it: the Alps most. Plain geography; enough for a bonus,
 * not a map of the relief.
 */
export const MOUNTAINS: ReadonlyArray<{ name: string; box: readonly [number, number, number, number]; weight: number }> = [
  { name: "Alps", box: [5.0, 43.8, 16.5, 48.2], weight: 2 },
  { name: "Pyrenees", box: [-2.0, 42.2, 3.3, 43.3], weight: 1.6 },
  { name: "Carpathians", box: [17.5, 44.5, 27.0, 50.0], weight: 1 },
  { name: "Apennines", box: [8.5, 38.0, 16.5, 44.6], weight: 0.9 },
  { name: "Dinaric Alps", box: [14.0, 41.5, 21.0, 46.0], weight: 0.8 },
  { name: "Scandinavian mountains", box: [5.0, 58.5, 20.0, 69.5], weight: 0.8 },
  { name: "Sierra Nevada", box: [-4.0, 36.8, -2.4, 37.4], weight: 1 },
  { name: "Cantabrian Mountains", box: [-8.0, 42.6, -3.3, 43.4], weight: 1 },
  { name: "Corsica", box: [8.5, 41.3, 9.6, 43.0], weight: 1 },
  { name: "Balkan Mountains", box: [22.3, 41.4, 26.5, 43.4], weight: 0.8 },
  { name: "Massif Central", box: [1.8, 44.0, 4.8, 46.2], weight: 0.7 },
  { name: "Vosges and Black Forest", box: [6.7, 47.6, 8.6, 48.9], weight: 0.5 },
  { name: "Scottish Highlands", box: [-6.5, 56.0, -2.5, 58.7], weight: 0.6 },
];

/** How far a range still counts for a point outside it, km. */
const RELIEF_REACH_KM = 150;

/** Tiles this close, centre to centre, are one system, km; or within 1.5 tiles across, for the coarse ones. */
const LINK_KM = 60;

/**
 * How far short of a system's edge the flight starts, km: the storms
 * towering ahead from the first moment, a little over two minutes out at cruise.
 * How close another storm may stand to the start; and the furthest from its
 * towers a start may be, km, however far its rain reaches, which at four
 * times the speed is about a minute's flight.
 */
export const START_KM = 30;
export const MAX_START_KM = 80;
const CLEAR_KM = 15;

const FEET_PER_M = 3.28084;
/** The weakest echo a flight is worth aiming at from outside it, dBZ: a shower; drizzle is not. */
export const SHOWER_DBZ = 35;

/**
 * The level a storm is flown at, metres: among its clouds, so the flight
 * starts where they are and not high over them, with little to come down.
 *
 * A shower's cloud is shallow, from its base to four or five kilometres, so
 * a flight at a weak one (35 dBZ and under) starts at FL070, about 2 km. A
 * thunderstorm's strongest echo, the rain and the hail held up in its
 * updraft, stands at mid levels under the anvil; a strong one (60 dBZ, hail)
 * is flown at FL170, about 5 km, its towers still well over the aircraft,
 * and those between on a straight line from one to the other: FL110 at
 * 45 dBZ, FL150 at 55. To the thousand feet, as levels are flown. With no
 * storm, FL090: low enough for the ground to read.
 */
export function stormLevel(peakDbz: number | null): number {
  if (peakDbz === null) return 9_000 / FEET_PER_M;
  const strength = Math.min(Math.max((peakDbz - SHOWER_DBZ) / 25, 0), 1);
  return (Math.round(7 + strength * (17 - 7)) * 1000) / FEET_PER_M;
}
/** How far above the ground the start keeps, over the first stretch of the way in, metres and km. */
const TERRAIN_MARGIN_M = 3000;
const TERRAIN_CHECK_KM = 60;
export const START_TAS = 220;

/** How quickly a system's pull falls away with its distance from where the reader looked, km. */
const NEARNESS_KM = 400;

/**
 * Where the storm layer's sun stands, as a bearing: from the west, a little
 * south of it (its `SUN`, -0.8 east and -0.25 north). Flying away from it,
 * the storms ahead are lit.
 */
export const SUN_BEARING = wrap360((Math.atan2(-0.8, -0.25) * 180) / Math.PI);

const KM = 1000;
const EARTH_CIRCUMFERENCE_KM = 40075.016;

/** How wide a tile is on the ground, km. */
function tileWidthKm(tile: StormTile): number {
  if (!tile.tile) return 26;
  return (EARTH_CIRCUMFERENCE_KM * Math.cos((tile.lat * Math.PI) / 180)) / 2 ** tile.tile[0];
}

/** How much a range adds at a point: its weight inside it, fading out over `RELIEF_REACH_KM` outside. */
export function reliefAt(lon: number, lat: number): number {
  let best = 0;
  for (const { box: [west, south, east, north], weight } of MOUNTAINS) {
    const nearLon = Math.min(Math.max(lon, west), east);
    const nearLat = Math.min(Math.max(lat, south), north);
    const outside = distanceM(lon, lat, nearLon, nearLat) / KM;
    best = Math.max(best, weight * Math.max(0, 1 - outside / RELIEF_REACH_KM));
  }
  return best;
}

/**
 * The listed volumes grouped into systems, strongest first. Coarse tiles
 * where there are any, which cover every storm in a third of the tiles;
 * the fine ones where not.
 */
export function stormSystems(tiles: readonly StormTile[]): StormSystem[] {
  const coarse = tiles.filter((tile) => tile.coarse);
  const used = coarse.length ? coarse : tiles.filter((tile) => !tile.coarse);
  const parent = used.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < used.length; i += 1) {
    for (let j = i + 1; j < used.length; j += 1) {
      const reach = Math.max(LINK_KM, 1.5 * Math.max(tileWidthKm(used[i]), tileWidthKm(used[j])));
      if (distanceM(used[i].lon, used[i].lat, used[j].lon, used[j].lat) / KM <= reach) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, StormTile[]>();
  used.forEach((tile, i) => groups.set(root(i), [...groups.get(root(i)) ?? [], tile]));
  return [...groups.values()].map((members) => {
    // The middle weighted hard towards the strongest echo, where the towers
    // are: a system can be hundreds of kilometres of rain, and its middle
    // by area is somewhere in the drizzle.
    const weightOf = (tile: StormTile) => 0.01 + Math.max(0, (tile.peakDbz ?? 0) - 35) ** 2;
    const total = members.reduce((sum, tile) => sum + weightOf(tile), 0);
    const lon = members.reduce((sum, tile) => sum + tile.lon * weightOf(tile), 0) / total;
    const lat = members.reduce((sum, tile) => sum + tile.lat * weightOf(tile), 0) / total;
    const radiusKm = Math.max(...members.map((tile) => distanceM(lon, lat, tile.lon, tile.lat) / KM + tileWidthKm(tile) / 2));
    const strength = members.reduce((sum, tile) => (
      sum + Math.max(0, (tile.peakDbz ?? 0) - 30) * (tile.areaKm2 ?? tileWidthKm(tile) ** 2 / 4)
    ), 0);
    const extent = members.map((tile) => {
      const [east, north] = offsetM(lon, lat, tile.lon, tile.lat);
      return { east: east / KM, north: north / KM, half: tileWidthKm(tile) / 2 };
    });
    return {
      lon, lat, radiusKm, strength, strikes: 0, tiles: members.length, extent,
      peakDbz: Math.max(...members.map((tile) => tile.peakDbz ?? 0)),
    };
  }).sort((a, b) => b.strength - a.strength);
}

/** A lightning strike: where, and when, ms since the epoch. */
export interface Strike {
  lon: number;
  lat: number;
  at: number;
}

/**
 * How far outside a system's tiles a strike still counts as its own, km:
 * lightning comes down under the anvil, ahead of the rain the radar sees,
 * and the networks place a strike to a few hundred metres at best.
 */
const STRIKE_REACH_KM = 10;

/** How many of `strikes` struck in a system: in one of its tiles, or within `STRIKE_REACH_KM` of one. */
export function strikesIn(system: Pick<StormSystem, "lon" | "lat" | "radiusKm" | "extent">, strikes: readonly Strike[]): number {
  let count = 0;
  for (const strike of strikes) {
    if (distanceM(system.lon, system.lat, strike.lon, strike.lat) / KM > system.radiusKm + STRIKE_REACH_KM) continue;
    const [east, north] = offsetM(system.lon, system.lat, strike.lon, strike.lat).map((metres) => metres / KM);
    if (system.extent.some((tile) => Math.max(Math.abs(east - tile.east), Math.abs(north - tile.north)) <= tile.half + STRIKE_REACH_KM)) count += 1;
  }
  return count;
}

/** The systems again, each with how many of `strikes` struck in it. */
export function withStrikes(systems: readonly StormSystem[], strikes: readonly Strike[]): StormSystem[] {
  return systems.map((system) => ({ ...system, strikes: strikesIn(system, strikes) }));
}

/**
 * The strongest echo from which a system is heavy, dBZ: a thunderstorm's
 * core with hail likely in it, the cells the plan's chart marks.
 */
export const HEAVY_DBZ = 50;
/** As many strikes as make a system heavy whatever its echo: a thunderstorm going off. */
export const HEAVY_STRIKES = 25;

/** Whether a system is a heavy one: a hail core, or lightning going off in it. */
export const isHeavy = (system: Pick<StormSystem, "peakDbz" | "strikes">): boolean => (
  system.peakDbz >= HEAVY_DBZ || system.strikes >= HEAVY_STRIKES
);

/**
 * How much a system is worth flying at, before its nearness: its strength
 * (rain and area), raised for a heavy core, much more for the lightning in
 * it, and most of all for mountains under and round it, since towers over
 * terrain are what a flight among storms is for. Lightning and relief count
 * as products, so a busy cluster over the Alps beats a bigger, quieter rain
 * area over the plains, and a quiet one over the Alps too.
 *
 * - heavy core: ×1 to 45 dBZ, ×3 at 55, ×4 at 60
 * - lightning: ×(1 + √strikes / 2), so ×6 at 100 strikes, ×11 at 400
 * - relief: ×(1 + 2 × range weight), so ×5 in the Alps, ×2.8 in the Apennines
 */
export function stormWorth(system: StormSystem): number {
  const heavy = 1 + Math.max(0, system.peakDbz - 45) / 5;
  const lightning = 1 + Math.sqrt(system.strikes) / 2;
  const relief = 1 + 2 * reliefAt(system.lon, system.lat);
  return system.strength * heavy * lightning * relief;
}

/**
 * The systems in the order the plan offers them: their worth (`stormWorth`)
 * over their distance from where the reader looked, which counts by its
 * square, so that within a few hundred kilometres the mountains and the
 * lightning decide, and a storm the reader has framed still beats a quiet
 * one by the mountains a continent away. N in flight goes by severity
 * instead (`bySeverity`).
 */
export function rankSystems(systems: readonly StormSystem[], lookLon: number, lookLat: number): StormSystem[] {
  const score = (system: StormSystem) => {
    const away = distanceM(lookLon, lookLat, system.lon, system.lat) / KM;
    return stormWorth(system) / (1 + (away / NEARNESS_KM) ** 2);
  };
  return [...systems].sort((a, b) => score(b) - score(a));
}

/**
 * The way in to a system: the best of twelve bearings round it. A start
 * with another storm on it scores next to nothing; then high ground under
 * the way in, then the sun behind.
 */
export function approachTo(
  system: StormSystem, tiles: readonly StormTile[], groundAt: (lon: number, lat: number) => number | null = () => null,
): Approach {
  let best: { score: number; lon: number; lat: number; heading: number } | null = null;
  for (let i = 0; i < 12; i += 1) {
    const from = i * 30;
    const [lon, lat] = destination(system.lon, system.lat, from, Math.min(edgeKm(system, from) + START_KM, MAX_START_KM) * KM);
    // Nose on its middle: the way back along a great circle is not quite the way out turned round.
    const heading = bearingDeg(lon, lat, system.lon, system.lat);
    const crowded = tiles.some((tile) => distanceM(lon, lat, tile.lon, tile.lat) / KM < CLEAR_KM + tileWidthKm(tile) / 2);
    let relief = 0;
    for (let km = 0; km <= START_KM; km += 10) {
      const [x, y] = destination(lon, lat, heading, km * KM);
      relief += reliefAt(x, y) / (START_KM / 10 + 1);
    }
    const sunBehind = (1 + Math.cos((wrap180(heading - (SUN_BEARING + 180)) * Math.PI) / 180)) / 2;
    const score = (crowded ? 0.05 : 1) * (1 + 0.6 * relief) * (0.45 + 0.55 * sunBehind);
    if (!best || score > best.score) best = { score, lon, lat, heading };
  }
  const { lon, lat, heading } = best!;
  return { lon, lat, heading, altitude: startAltitude(lon, lat, heading, groundAt, system.peakDbz), target: system };
}

/**
 * How far the system reaches from its middle towards a bearing, km: the
 * furthest edge of its tiles in a corridor that way, as wide as a tile. A
 * long line of storms is short across and long along; its radius is the long
 * way, and from the side a start that far out was hundreds of kilometres
 * from the nearest storm.
 */
export function edgeKm(system: Pick<StormSystem, "extent" | "radiusKm">, bearing: number): number {
  const theta = (bearing * Math.PI) / 180;
  const [along, across] = [[Math.sin(theta), Math.cos(theta)], [Math.cos(theta), -Math.sin(theta)]];
  let edge = 0;
  for (const { east, north, half } of system.extent) {
    const forward = east * along[0] + north * along[1];
    const side = east * across[0] + north * across[1];
    if (Math.abs(side) <= half * 1.5) edge = Math.max(edge, forward + half);
  }
  return Math.min(edge, system.radiusKm);
}

/** The storm's level (`stormLevel`), or higher where the ground under the first stretch of the way in asks for it. */
export function startAltitude(
  lon: number, lat: number, heading: number, groundAt: (lon: number, lat: number) => number | null, peakDbz: number | null = null,
): number {
  return Math.max(stormLevel(peakDbz), terrainFloor(lon, lat, heading, groundAt) ?? 0);
}

/**
 * The lowest a start may be: `TERRAIN_MARGIN_M` over the highest ground
 * under the first stretch of the way, metres; null where the map has none
 * of that ground loaded.
 */
export function terrainFloor(
  lon: number, lat: number, heading: number, groundAt: (lon: number, lat: number) => number | null,
): number | null {
  let floor: number | null = null;
  for (let km = 0; km <= TERRAIN_CHECK_KM; km += 5) {
    const [x, y] = destination(lon, lat, heading, km * KM);
    const ground = groundAt(x, y);
    if (ground !== null) floor = Math.max(floor ?? -Infinity, ground + TERRAIN_MARGIN_M);
  }
  return floor;
}

/**
 * With no weather on the radar: over where the reader looked, set back so
 * it is ahead, on the camera's bearing.
 */
export function clearSkyStart(
  lookLon: number, lookLat: number, bearing: number, groundAt: (lon: number, lat: number) => number | null = () => null,
): Approach {
  const heading = wrap360(bearing);
  const [lon, lat] = destination(lookLon, lookLat, heading + 180, 30 * KM);
  return { lon, lat, heading, altitude: startAltitude(lon, lat, heading, groundAt), target: null };
}

/**
 * The systems in order of how severe they are: the strongest echo first, and
 * of two as strong, the larger. What N steps through, from the worst weather
 * on the radar down.
 */
export function bySeverity(systems: readonly StormSystem[]): StormSystem[] {
  return [...systems].sort((a, b) => b.peakDbz - a.peakDbz || b.strength - a.strength);
}

/** A system this near the one flown at is that one, in a newer list: storms move between scans, km. */
const SAME_SYSTEM_KM = 120;

/**
 * The approach to the next system after `after`, by severity (`bySeverity`),
 * round again past the last; the severest where `after` is none or no longer
 * listed, and the clear-sky start where there is no weather.
 */
export function chooseApproach(
  tiles: readonly StormTile[], look: { lon: number; lat: number; bearing: number }, after: Pick<StormSystem, "lon" | "lat"> | null,
  groundAt: (lon: number, lat: number) => number | null = () => null,
): Approach {
  const ranked = bySeverity(stormSystems(tiles));
  if (!ranked.length) return clearSkyStart(look.lon, look.lat, look.bearing, groundAt);
  const away = (system: StormSystem) => (after ? distanceM(after.lon, after.lat, system.lon, system.lat) / KM : Infinity);
  const current = ranked.reduce((best, system, i) => (away(system) <= SAME_SYSTEM_KM && (best < 0 || away(system) < away(ranked[best])) ? i : best), -1);
  return approachTo(ranked[(current + 1) % ranked.length], tiles, groundAt);
}

/** The bearing and distance from a point to a system, degrees and metres. */
export function towards(lon: number, lat: number, system: { lon: number; lat: number }): { bearing: number; distance: number } {
  return { bearing: bearingDeg(lon, lat, system.lon, system.lat), distance: distanceM(lon, lat, system.lon, system.lat) };
}
