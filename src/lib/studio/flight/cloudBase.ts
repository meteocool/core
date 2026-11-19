/**
 * How high the clouds of a flight begin: worked out from the weather
 * stations round it, where there are any.
 *
 * Air lifted from the ground cools until its water condenses, and how far
 * up that is depends on how dry it was: about 125 metres for every degree
 * between its temperature and its dew point. That height over a station is
 * where a cumulus over it has its base. So the stations near a flight say
 * where its clouds begin, lower on a damp day and higher on a dry one,
 * which a radar cannot. Where no station reports (most of the world the
 * radars cover), the flight keeps a usual base (`USUAL_BASE_KM`).
 *
 * The arithmetic is here; asking the stations is stationAir.ts.
 */
import { distanceM } from "./geo";

/** Where cloud begins when nothing says, kilometres above the sea. */
export const USUAL_BASE_KM = 1.5;
/** As low and as high as a base worked out is believed, kilometres above the sea. */
export const BASE_RANGE_KM: [number, number] = [0.5, 3.6];
/** How far round a place its stations count, km, and how few of them are still an answer. */
export const BASE_REACH_KM = 160;
export const BASE_STATIONS_MIN = 3;
/** Metres of lift to a degree between temperature and dew point. */
const LIFT_M_PER_DEGREE = 125;
/**
 * A station this close to saturated is in the rain or in fog: its base is
 * the ground, and says nothing of the towers round it.
 */
const SATURATED_DEGREES = 1;

/** As much of a station's report as this needs. */
export interface StationAir {
  lon: number;
  lat: number;
  elevation: number;
  temperature: number;
  dewPoint: number;
}

/** Where air lifted from a station condenses, metres above the sea. */
export const condensationLevel = (station: Pick<StationAir, "elevation" | "temperature" | "dewPoint">): number => (
  station.elevation + Math.max(station.temperature - station.dewPoint, 0) * LIFT_M_PER_DEGREE
);

/**
 * The cloud base round a place, from the stations within reach that are not
 * in the rain: the middle one of theirs, so one valley's fog or one dry
 * summit does not set it. Null with too few to say.
 */
export function cloudBase(stations: readonly StationAir[], lon: number, lat: number): CloudBase | null {
  const near = stations.filter((station) => distanceM(lon, lat, station.lon, station.lat) <= BASE_REACH_KM * 1000);
  const levels = near
    .filter((station) => station.temperature - station.dewPoint >= SATURATED_DEGREES)
    .map(condensationLevel)
    .sort((a, b) => a - b);
  if (levels.length < BASE_STATIONS_MIN) return null;
  // How much warmer than a standard atmosphere the air is at the stations, each at its own height.
  const warmer = middle(near.map((station) => station.temperature - (15 - (6.5 * station.elevation) / 1000)).sort((a, b) => a - b));
  return { km: Math.min(Math.max(middle(levels) / 1000, BASE_RANGE_KM[0]), BASE_RANGE_KM[1]), stations: levels.length, warmer };
}

/** The middle one of a sorted list, or between the middle two. */
const middle = (sorted: number[]): number => (
  sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
);

/** Where the clouds begin, and what else the stations that said so say of the air. */
export interface CloudBase {
  /** Kilometres above the sea. */
  km: number;
  /** How many stations it is the middle of. */
  stations: number;
  /** How many degrees warmer than a standard atmosphere the air is there: what puts the freezing level higher or lower. */
  warmer: number;
}

/** Where the air is at freezing, metres above the sea, in a standard atmosphere `warmer` degrees warmer. */
export const freezingLevel = (warmer = 0): number => Math.max(0, ((15 + warmer) / 6.5) * 1000);
