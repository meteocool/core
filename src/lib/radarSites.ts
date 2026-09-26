/**
 * DWD's weather radars, for saying which of them a storm's volume was built from.
 *
 * A volume names its radars by DWD's three-letter short name, which is all the
 * worker needs and means nothing to a reader. Coordinates and antenna heights
 * are ng's `volumes.SITES`, which reads them from the sites' own files, so the
 * distances here are the ones the volume was actually georeferenced with.
 */

export interface RadarSite {
  /** Where it stands, which is what DWD calls it. */
  name: string;
  lat: number;
  lon: number;
  /** Antenna height above sea level, in metres. */
  heightM: number;
}

export const RADAR_SITES: Record<string, RadarSite> = {
  asb: { name: "Borkum", lat: 53.564129, lon: 6.748317, heightM: 36.2 },
  boo: { name: "Boostedt", lat: 54.004381, lon: 10.046899, heightM: 124.6 },
  drs: { name: "Dresden", lat: 51.124639, lon: 13.768639, heightM: 263.4 },
  eis: { name: "Eisberg", lat: 49.540667, lon: 12.402788, heightM: 799.1 },
  ess: { name: "Essen", lat: 51.405649, lon: 6.967111, heightM: 185.1 },
  fbg: { name: "Feldberg", lat: 47.873611, lon: 8.003611, heightM: 1516.1 },
  fld: { name: "Flechtdorf", lat: 51.311197, lon: 8.801998, heightM: 627.9 },
  hnr: { name: "Hannover", lat: 52.460083, lon: 9.694533, heightM: 97.8 },
  isn: { name: "Isen", lat: 48.174705, lon: 12.101779, heightM: 677.8 },
  mem: { name: "Memmingen", lat: 48.042145, lon: 10.219222, heightM: 724.4 },
  neu: { name: "Neuhaus", lat: 50.500114, lon: 11.135034, heightM: 879.6 },
  nhb: { name: "Neuheilenbach", lat: 50.109656, lon: 6.548328, heightM: 585.9 },
  oft: { name: "Offenthal", lat: 49.984745, lon: 8.712933, heightM: 245.8 },
  pro: { name: "Prötzel", lat: 52.648667, lon: 13.858212, heightM: 193.9 },
  ros: { name: "Rostock", lat: 54.17566, lon: 12.058076, heightM: 37.0 },
  tur: { name: "Türkheim", lat: 48.585379, lon: 9.782675, heightM: 767.6 },
  umd: { name: "Ummendorf", lat: 52.160096, lon: 11.176091, heightM: 185.2 },
};

/** The lowest elevation in DWD's volume scan, in degrees. */
export const LOWEST_ELEVATION_DEG = 0.5;

const EARTH_RADIUS_KM = 6371;
/**
 * The standard-atmosphere 4/3 earth: refraction bends a radar beam back
 * toward the ground, which is the same as a straight beam over a larger
 * planet. The textbook model, and the one wradlib's georeferencing uses.
 */
const EFFECTIVE_RADIUS_KM = (4 / 3) * EARTH_RADIUS_KM;

/** Great-circle distance, in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * How high a beam's centre is above sea level this far out, in kilometres.
 *
 * The number that says what a far radar can and cannot see: at 150 km the
 * lowest beam is already two kilometres up, so everything below that in a
 * storm that far off came from somewhere else, or from nowhere.
 */
export function beamHeightKm(rangeKm: number, elevationDeg: number, siteHeightM: number): number {
  const k = EFFECTIVE_RADIUS_KM;
  const theta = (elevationDeg * Math.PI) / 180;
  return Math.sqrt(rangeKm ** 2 + k ** 2 + 2 * rangeKm * k * Math.sin(theta)) - k + siteHeightM / 1000;
}

export interface Contribution {
  /** DWD's short name, as the volume carries it. */
  code: string;
  /** The place name, or the short name for a radar this table does not know. */
  name: string;
  /** From the radar to the storm's peak, when the radar is known. */
  distanceKm: number | null;
  /** The lowest beam's height over the peak, when the radar is known. */
  lowestBeamKm: number | null;
}

/** The radars a volume was built from, nearest first, with what each could see of it. */
export function contributions(sites: readonly string[], lat: number, lon: number): Contribution[] {
  return sites
    .map((code) => {
      const site = RADAR_SITES[code.toLowerCase()];
      if (!site) return { code, name: code.toUpperCase(), distanceKm: null, lowestBeamKm: null };
      const range = distanceKm(site.lat, site.lon, lat, lon);
      return {
        code,
        name: site.name,
        distanceKm: range,
        lowestBeamKm: beamHeightKm(range, LOWEST_ELEVATION_DEG, site.heightM),
      };
    })
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}
