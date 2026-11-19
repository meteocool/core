/**
 * Where a flight starts: which storm system it flies at, and from where.
 *
 * The listed volumes are every tile of sky it rains in, across every
 * network. Grouped by adjacency they are storm systems, and the best one to
 * fly at is strong, near mountains (the relief is half of what a flight
 * among storms shows) and near where the reader was looking in Studio, so a
 * storm the reader has framed wins over a stronger one a continent away.
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
  { name: "Massif Central", box: [1.8, 44.0, 4.8, 46.2], weight: 0.7 },
  { name: "Scottish Highlands", box: [-6.5, 56.0, -2.5, 58.7], weight: 0.6 },
];

/** How far a range still counts for a point outside it, km. */
const RELIEF_REACH_KM = 150;

/** Tiles this close, centre to centre, are one system, km; or within 1.5 tiles across, for the coarse ones. */
const LINK_KM = 60;

/**
 * How far short of a system's edge the flight starts, km, and how close
 * another storm may stand to the start; and the furthest from its towers a
 * start may be, km, however far its rain reaches, which at four times the
 * speed is a couple of minutes' flight.
 */
export const START_KM = 50;
export const MAX_START_KM = 120;
const CLEAR_KM = 15;

/** How high it starts: FL240, low enough for the relief to read with the storms towering over it. */
export const START_ALTITUDE_M = 7300;
/** How far above the ground the start keeps, over the first stretch of the way in, metres and km. */
const TERRAIN_MARGIN_M = 3000;
const TERRAIN_CHECK_KM = 60;
export const START_TAS = 220;

/** How quickly a system's pull falls away with its distance from where the reader looked, km. */
const NEARNESS_KM = 500;

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
      lon, lat, radiusKm, strength, tiles: members.length, extent,
      peakDbz: Math.max(...members.map((tile) => tile.peakDbz ?? 0)),
    };
  }).sort((a, b) => b.strength - a.strength);
}

/**
 * The systems in the order a flight takes them: strength, with the relief
 * under and around one and its nearness to where the reader looked.
 */
export function rankSystems(systems: readonly StormSystem[], lookLon: number, lookLat: number): StormSystem[] {
  const score = (system: StormSystem) => {
    const away = distanceM(lookLon, lookLat, system.lon, system.lat) / KM;
    return system.strength * (1 + reliefAt(system.lon, system.lat)) / (1 + away / NEARNESS_KM);
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
  return { lon, lat, heading, altitude: startAltitude(lon, lat, heading, groundAt), target: system };
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

/** FL240, or higher where the ground under the first stretch of the way in asks for it. */
export function startAltitude(
  lon: number, lat: number, heading: number, groundAt: (lon: number, lat: number) => number | null,
): number {
  let altitude = START_ALTITUDE_M;
  for (let km = 0; km <= TERRAIN_CHECK_KM; km += 5) {
    const [x, y] = destination(lon, lat, heading, km * KM);
    const ground = groundAt(x, y);
    if (ground !== null) altitude = Math.max(altitude, ground + TERRAIN_MARGIN_M);
  }
  return altitude;
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

/** The `index`th best approach, round again past the last; the clear-sky start where there is no weather. */
export function chooseApproach(
  tiles: readonly StormTile[], look: { lon: number; lat: number; bearing: number }, index: number,
  groundAt: (lon: number, lat: number) => number | null = () => null,
): Approach {
  const ranked = rankSystems(stormSystems(tiles), look.lon, look.lat);
  if (!ranked.length) return clearSkyStart(look.lon, look.lat, look.bearing, groundAt);
  return approachTo(ranked[((index % ranked.length) + ranked.length) % ranked.length], tiles, groundAt);
}

/** The bearing and distance from a point to a system, degrees and metres. */
export function towards(lon: number, lat: number, system: { lon: number; lat: number }): { bearing: number; distance: number } {
  return { bearing: bearingDeg(lon, lat, system.lon, system.lat), distance: distanceM(lon, lat, system.lon, system.lat) };
}
