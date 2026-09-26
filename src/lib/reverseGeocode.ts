/**
 * Turning a tapped coordinate into a place name for the forecast strip's title.
 *
 * Two providers, tried in that order.
 *
 * First, meteocool's own Nominatim (see urls.ts). It holds the OSM planet
 * imported at Nominatim's `admin` style -- administrative boundaries and places,
 * no streets and no addresses -- which is all a panel title ever wanted, and
 * self-hosting it means no key, no rate limit and no third party watching where
 * people tap.
 *
 * Second, BigDataCloud, which is what this file used to be and still is
 * wherever ours has no answer. That is not a hedge: Nominatim returns nothing
 * at all a few kilometres offshore, which on a rain radar is an ordinary place
 * to tap, and it returns nothing for a point outside whatever extract the
 * instance imported. BigDataCloud answers both, needs no key, and is CORS-open
 * to any origin because it is the endpoint they publish for browser calls.
 *
 * Not Open-Meteo, which was the original ask: their geocoding API only goes
 * forwards. /v1/search wants a `name` and refuses coordinates, /v1/get wants an
 * id, and there is no /v1/reverse -- all three answer 404 or "No value found at
 * 'name'". The proximity search exists in their source and is commented out.
 *
 * Everything provider-shaped is still in this file: the endpoints, the two
 * response shapes, and the one function that maps each onto the fields a label
 * is built from. Swapping either provider is those three.
 */

import { geocodingUrl } from "../urls";
import { tracked } from "./progress";

const BIGDATACLOUD_ENDPOINT = "https://api.bigdatacloud.net/data/reverse-geocode-client";

/**
 * The fields a label is built from. BigDataCloud's own names, because it got
 * here first and they read well; the Nominatim response is mapped onto them.
 */
interface Place {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
  /** The Landkreis or its equivalent: what a storm tens of kilometres across is over. */
  county?: string;
  /** The sea, when the point is at sea and there is no settlement to name. */
  sea?: string;
}

/**
 * Coarse enough that panning a few hundred metres and tapping again is a hit,
 * fine enough that neighbouring towns are separate entries. 3 decimals is
 * roughly 100m at these latitudes.
 */
const cacheKey = (lat: number, lon: number, language: string, scale: string) => (
  `${lat.toFixed(3)},${lon.toFixed(3)},${language},${scale}`
);

const cache = new Map<string, unknown>();
const CACHE_MAX = 200;

/**
 * The one request that matters is the latest one; the rest are stale taps.
 *
 * Per caller, not one for the whole app: the forecast strip, the lightning
 * chart and a storm's panel all look places up, often in the same second --
 * opening a storm moves the camera, which re-titles the lightning chart -- and
 * with a single slot each new lookup aborted whichever other panel's was still
 * on its way, and that panel was left without its name.
 */
const inFlight = new Map<string, AbortController>();

/**
 * How much ground the label has to cover.
 *
 * "local" is a point: the city is what someone reading a weather panel wants --
 * "Hanover", not "Mitte, Hanover, Lower Saxony, Germany".
 *
 * The others are for a viewport, where the city under the centre pixel is a
 * poor name for everything on screen. Zoomed out far enough that the box spans
 * a state, the state is the honest answer, and further out still, the country.
 */
export type GeocodeScale = "local" | "regional" | "country";

// The sea last everywhere: it is only ever set where nothing else is.
const ORDER: Record<GeocodeScale, Array<keyof Place>> = {
  local: ["city", "locality", "principalSubdivision", "countryName", "sea"],
  regional: ["principalSubdivision", "city", "countryName", "sea"],
  country: ["countryName", "principalSubdivision", "sea"],
};

/**
 * Nominatim answers at whatever level its `zoom` asks for, so asking for the
 * street level it does not have wastes the lookup. These are the three levels
 * ORDER above actually reads: a settlement, a state, a country.
 */
const NOMINATIM_ZOOM: Record<GeocodeScale, number> = {
  local: 12,
  regional: 8,
  country: 3,
};

function pickLabel(place: Place, scale: GeocodeScale): string | null {
  for (const field of ORDER[scale]) {
    const value = place[field]?.trim();
    if (value) return value;
  }
  return null;
}

/** What BigDataCloud returns beyond the flat fields: the named areas the point is in. */
interface BigDataCloudResponse extends Place {
  localityInfo?: {
    administrative?: Array<{ name?: string; adminLevel?: number }>;
    informative?: Array<{ name?: string; description?: string }>;
  };
}

/**
 * The flat fields, plus the county and the sea from the lists behind them.
 *
 * At sea every flat field is empty but `locality`, which is then the name of
 * an exclusive economic zone -- a true answer, and no name for where a shower
 * is. The sea itself is the first informative entry that describes something:
 * the ones without a description are zones of the same kind, and a name with
 * a slash in it is a time zone.
 */
function fromBigDataCloudBody(body: BigDataCloudResponse): Place {
  const { administrative = [], informative = [] } = body.localityInfo ?? {};
  const atSea = !body.city && !body.principalSubdivision && !body.countryName;
  return {
    city: body.city,
    locality: atSea ? undefined : body.locality,
    principalSubdivision: body.principalSubdivision,
    countryName: body.countryName,
    // Level 6 is the Kreis in Germany and the matching tier in its neighbours.
    county: administrative.find((area) => area.adminLevel === 6)?.name,
    sea: atSea ? informative.find((area) => area.description && !area.name?.includes("/"))?.name : undefined,
  };
}

/** What Nominatim's jsonv2 format returns, of which this reads the address. */
interface NominatimResponse {
  error?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    suburb?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

/**
 * OSM has no single "the settlement here" tag, so a place arrives as whichever
 * of city/town/village/municipality fits its size. They are alternatives, not a
 * hierarchy, and exactly one of them is normally present.
 */
function asPlace(body: NominatimResponse): Place | null {
  const address = body.address;
  if (!address) return null;
  return {
    city: address.city ?? address.town ?? address.village ?? address.municipality,
    locality: address.suburb ?? address.hamlet,
    principalSubdivision: address.state ?? address.county,
    countryName: address.country,
    county: address.county,
  };
}

async function fromNominatim(
  lat: number,
  lon: number,
  language: string,
  zoom: number,
  signal: AbortSignal,
): Promise<Place | null> {
  if (!geocodingUrl) return null;
  const query = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    zoom: String(zoom),
    "accept-language": language,
  });
  const response = await fetch(`${geocodingUrl}/reverse?${query}`, { signal });
  if (!response.ok) return null;
  // A point with nothing around it is a 200 carrying `{"error": "Unable to
  // geocode"}`, not a 404, so the body has to be read to know there was a miss.
  return asPlace(await response.json() as NominatimResponse);
}

async function fromBigDataCloud(
  lat: number,
  lon: number,
  language: string,
  signal: AbortSignal,
): Promise<Place | null> {
  const url = `${BIGDATACLOUD_ENDPOINT}?latitude=${lat}&longitude=${lon}&localityLanguage=${language}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return fromBigDataCloudBody(await response.json() as BigDataCloudResponse);
}

/**
 * One lookup, cached, on its caller's own slot, never rejecting.
 *
 * `read` turns a provider's place into the answer, or null when that place
 * does not hold what the caller wants -- which sends the lookup on to the
 * next provider rather than settling for it.
 */
async function lookUp<T>(
  lat: number,
  lon: number,
  language: string,
  kind: string,
  zoom: number,
  channel: string,
  read: (place: Place) => T | null,
): Promise<T | null> {
  // Some locales arrive as "de-DE"; the API takes the bare language.
  const lang = language.slice(0, 2).toLowerCase();
  const key = cacheKey(lat, lon, lang, kind);
  const cached = cache.get(key);
  if (cached !== undefined) return cached as T | null;

  inFlight.get(channel)?.abort();
  const controller = new AbortController();
  inFlight.set(channel, controller);

  return tracked("geocode", async () => {
    try {
      let answer: T | null = null;
      try {
        const place = await fromNominatim(lat, lon, lang, zoom, controller.signal);
        answer = place ? read(place) : null;
      } catch {
        // Ours being down is a reason to ask someone else, not to give up. An
        // abort is not: a newer tap is already in flight and owns the answer.
        if (controller.signal.aborted) return null;
      }
      if (answer === null) {
        const place = await fromBigDataCloud(lat, lon, lang, controller.signal);
        answer = place ? read(place) : null;
      }

      // Oldest out first. A session that taps 200 distinct places has long since
      // stopped caring about the first one.
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, answer);
      return answer;
    } catch {
      // Aborted, offline, rate-limited, malformed -- all the same to the caller.
      return null;
    } finally {
      if (inFlight.get(channel) === controller) inFlight.delete(channel);
    }
  });
}

/**
 * The place at these coordinates, or null when there is no answer worth
 * showing. Never throws and never rejects: a missing label is a cosmetic loss,
 * and the strip has a perfectly good title without one.
 *
 * `channel` names the caller: a newer lookup cancels an older one on the same
 * channel only.
 */
export function reverseGeocode(
  lat: number,
  lon: number,
  language = "en",
  scale: GeocodeScale = "local",
  channel = "place",
): Promise<string | null> {
  return lookUp(lat, lon, language, scale, NOMINATIM_ZOOM[scale], channel, (place) => pickLabel(place, scale));
}

/** Where a storm is: the settlement under its peak, and the county and state it is in. */
export interface StormPlace {
  name: string;
  /** The Landkreis and state, or whichever of them there is; null at sea. */
  area: string | null;
}

/**
 * The name for a storm, which is not the name for a tapped point.
 *
 * A storm is tens of kilometres across, so the town under its peak alone
 * undersells it and the state alone says nothing -- the Landkreis is the
 * scale a reader places a storm by, and it goes under the town. Offshore,
 * where most of a coastal radar's storms are, it is the sea's name.
 */
export function stormPlace(lat: number, lon: number, language = "en"): Promise<StormPlace | null> {
  return lookUp(lat, lon, language, "storm", NOMINATIM_ZOOM.local, "storm", (place) => {
    const name = pickLabel(place, "local");
    if (!name) return null;
    if (name === place.sea) return { name, area: null };
    // A county named after its town ("Region Hannover" under "Hannover") and a
    // city that is its own county both repeat the name; the state still helps.
    const area = [place.county, place.principalSubdivision]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part) && part !== name && !(part as string).endsWith(` ${name}`));
    return { name, area: [...new Set(area)].join(", ") || null };
  });
}

/** The scale a map at this zoom is really showing. */
export function scaleForZoom(zoom: number): GeocodeScale {
  if (zoom >= 9) return "local";
  if (zoom >= 6) return "regional";
  return "country";
}
