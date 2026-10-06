/**
 * The weather radars of every network, for saying which of them a storm's
 * volume was built from.
 *
 * A volume names its radars by EUMETNET's node code (`deisn`, `frnan`), which
 * is all the worker needs and means nothing to a reader. Coordinates and
 * antenna heights are ng's `openradar.py` network tables, which read them off
 * the sites' own files, so the distances here are the ones the volume was
 * actually georeferenced with. Volumes from before every network joined name
 * DWD's radars by their bare three-letter code; those resolve too.
 */

export interface RadarSite {
  /** Where it stands, which is what its operator calls it. */
  name: string;
  lat: number;
  lon: number;
  /** Antenna height above sea level, in metres. */
  heightM: number;
  /** The lowest tilt its network scans, in degrees, from which the lowest beam's height follows. */
  lowestDeg: number;
}

const DWD = 0.5;
const SWISS = -0.2;
const FRENCH = 0.4;
const CZECH = 0.1;
const POLISH = 0.5;

export const RADAR_SITES: Record<string, RadarSite> = {
  deasb: { name: "Borkum", lat: 53.564129, lon: 6.748317, heightM: 36.2, lowestDeg: DWD },
  deboo: { name: "Boostedt", lat: 54.004381, lon: 10.046899, heightM: 124.6, lowestDeg: DWD },
  dedrs: { name: "Dresden", lat: 51.124639, lon: 13.768639, heightM: 263.4, lowestDeg: DWD },
  deeis: { name: "Eisberg", lat: 49.540667, lon: 12.402788, heightM: 799.1, lowestDeg: DWD },
  deess: { name: "Essen", lat: 51.405649, lon: 6.967111, heightM: 185.1, lowestDeg: DWD },
  defbg: { name: "Feldberg", lat: 47.873611, lon: 8.003611, heightM: 1516.1, lowestDeg: DWD },
  defld: { name: "Flechtdorf", lat: 51.311197, lon: 8.801998, heightM: 627.9, lowestDeg: DWD },
  dehnr: { name: "Hannover", lat: 52.460083, lon: 9.694533, heightM: 97.8, lowestDeg: DWD },
  deisn: { name: "Isen", lat: 48.174705, lon: 12.101779, heightM: 677.8, lowestDeg: DWD },
  demem: { name: "Memmingen", lat: 48.042145, lon: 10.219222, heightM: 724.4, lowestDeg: DWD },
  deneu: { name: "Neuhaus", lat: 50.500114, lon: 11.135034, heightM: 879.6, lowestDeg: DWD },
  denhb: { name: "Neuheilenbach", lat: 50.109656, lon: 6.548328, heightM: 585.9, lowestDeg: DWD },
  deoft: { name: "Offenthal", lat: 49.984745, lon: 8.712933, heightM: 245.8, lowestDeg: DWD },
  depro: { name: "Prötzel", lat: 52.648667, lon: 13.858212, heightM: 193.9, lowestDeg: DWD },
  deros: { name: "Rostock", lat: 54.17566, lon: 12.058076, heightM: 37.0, lowestDeg: DWD },
  detur: { name: "Türkheim", lat: 48.585379, lon: 9.782675, heightM: 767.6, lowestDeg: DWD },
  deumd: { name: "Ummendorf", lat: 52.160096, lon: 11.176091, heightM: 185.2, lowestDeg: DWD },

  chalb: { name: "Albis", lat: 47.284332, lon: 8.512, heightM: 938.0, lowestDeg: SWISS },
  chdol: { name: "La Dôle", lat: 46.425113, lon: 6.099415, heightM: 1682.0, lowestDeg: SWISS },
  chlem: { name: "Monte Lema", lat: 46.040761, lon: 8.833217, heightM: 1626.0, lowestDeg: SWISS },
  chppm: { name: "Plaine Morte", lat: 46.370646, lon: 7.486552, heightM: 2937.0, lowestDeg: SWISS },
  chwei: { name: "Weissfluhgipfel", lat: 46.834974, lon: 9.794458, heightM: 2850.0, lowestDeg: SWISS },

  frabb: { name: "Abbeville", lat: 50.13595, lon: 1.8347, heightM: 83.6, lowestDeg: FRENCH },
  fraja: { name: "Ajaccio", lat: 41.95313, lon: 8.70054, heightM: 784.0, lowestDeg: FRENCH },
  frale: { name: "Aléria", lat: 42.12971, lon: 9.49639, heightM: 63.0, lowestDeg: FRENCH },
  frave: { name: "Avesnes", lat: 50.12832, lon: 3.81181, heightM: 208.8, lowestDeg: FRENCH },
  frbla: { name: "Blaisy-Haut", lat: 47.35515, lon: 4.77594, heightM: 607.2, lowestDeg: FRENCH },
  frbol: { name: "Bollène", lat: 44.32305, lon: 4.76221, heightM: 325.0, lowestDeg: FRENCH },
  frbor: { name: "Bordeaux", lat: 44.83147, lon: -0.69188, heightM: 70.0, lowestDeg: FRENCH },
  frbou: { name: "Bourges", lat: 47.05861, lon: 2.35955, heightM: 173.5, lowestDeg: FRENCH },
  frcae: { name: "Falaise", lat: 48.92716, lon: -0.14955, heightM: 167.4, lowestDeg: FRENCH },
  frcol: { name: "Collobrières", lat: 43.21656, lon: 6.37291, heightM: 653.7, lowestDeg: FRENCH },
  frgre: { name: "Grèzes", lat: 45.1044, lon: 1.36967, heightM: 360.3, lowestDeg: FRENCH },
  frlep: { name: "Sembadel", lat: 45.28922, lon: 3.70948, heightM: 1143.4, lowestDeg: FRENCH },
  frmcl: { name: "Montclar", lat: 43.9905, lon: 2.60962, heightM: 678.7, lowestDeg: FRENCH },
  frmom: { name: "Momuy", lat: 43.62447, lon: -0.6094, heightM: 145.7, lowestDeg: FRENCH },
  frmtc: { name: "Montancy", lat: 47.36861, lon: 7.01897, heightM: 925.7, lowestDeg: FRENCH },
  frnan: { name: "Nancy", lat: 48.71576, lon: 6.58156, heightM: 296.3, lowestDeg: FRENCH },
  frnim: { name: "Nîmes", lat: 43.80614, lon: 4.50269, heightM: 78.1, lowestDeg: FRENCH },
  frniz: { name: "Saint-Nizier", lat: 46.06781, lon: 4.44535, heightM: 919.8, lowestDeg: FRENCH },
  fropo: { name: "Opoul", lat: 42.91839, lon: 2.86499, heightM: 718.0, lowestDeg: FRENCH },
  frpla: { name: "Plabennec", lat: 48.46088, lon: -4.42983, heightM: 110.8, lowestDeg: FRENCH },
  frtou: { name: "Toulouse", lat: 43.57432, lon: 1.3763, heightM: 187.1, lowestDeg: FRENCH },
  frtra: { name: "Trappes", lat: 48.77457, lon: 2.00831, heightM: 190.2, lowestDeg: FRENCH },
  frtre: { name: "Treillières", lat: 47.33741, lon: -1.65632, heightM: 81.0, lowestDeg: FRENCH },
  frtro: { name: "Arcis-sur-Aube", lat: 48.46213, lon: 4.30932, heightM: 164.8, lowestDeg: FRENCH },

  czbrd: { name: "Brdy", lat: 49.6583, lon: 13.8178, heightM: 916.0, lowestDeg: CZECH },
  czska: { name: "Skalky", lat: 49.5011, lon: 16.7885, heightM: 767.0, lowestDeg: CZECH },

  plbrz: { name: "Brzuchania", lat: 50.394169, lon: 20.083228, heightM: 434.4, lowestDeg: POLISH },
  plgdy: { name: "Gdynia", lat: 54.5009, lon: 18.2718, heightM: 261.0, lowestDeg: POLISH },
  plgsa: { name: "Góra Świętej Anny", lat: 50.4639, lon: 18.1532, heightM: 433.0, lowestDeg: POLISH },
  plleg: { name: "Legionowo", lat: 52.4052, lon: 20.9611, heightM: 122.3, lowestDeg: POLISH },
  plpas: { name: "Pastewnik", lat: 50.8925, lon: 16.0395, heightM: 691.9, lowestDeg: POLISH },
  plpoz: { name: "Poznań", lat: 52.4133, lon: 16.797, heightM: 123.3, lowestDeg: POLISH },
  plram: { name: "Ramża", lat: 50.1513, lon: 18.7251, heightM: 357.1, lowestDeg: POLISH },
  plrze: { name: "Rzeszów", lat: 50.1141, lon: 22.037, heightM: 241.2, lowestDeg: POLISH },
  plswi: { name: "Świdwin", lat: 53.7958, lon: 15.8368, heightM: 146.6, lowestDeg: POLISH },
  pluzr: { name: "Użranki", lat: 53.8557, lon: 21.4123, heightM: 237.0, lowestDeg: POLISH },
};

/** The lowest elevation in DWD's volume scan, in degrees. */
export const LOWEST_ELEVATION_DEG = DWD;

/** The site a volume names, by its code: EUMETNET's, or DWD's bare three letters from older volumes. */
export function radarSite(code: string): RadarSite | undefined {
  const lower = code.toLowerCase();
  return RADAR_SITES[lower] ?? RADAR_SITES[`de${lower}`];
}

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
  /** The node code, as the volume carries it. */
  code: string;
  /** The place name, or the code for a radar this table does not know. */
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
      const site = radarSite(code);
      if (!site) return { code, name: code.toUpperCase(), distanceKm: null, lowestBeamKm: null };
      const range = distanceKm(site.lat, site.lon, lat, lon);
      return {
        code,
        name: site.name,
        distanceKm: range,
        lowestBeamKm: beamHeightKm(range, site.lowestDeg, site.heightM),
      };
    })
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}
