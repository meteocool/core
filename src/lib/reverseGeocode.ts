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
}

/**
 * Coarse enough that panning a few hundred metres and tapping again is a hit,
 * fine enough that neighbouring towns are separate entries. 3 decimals is
 * roughly 100m at these latitudes.
 */
const cacheKey = (lat: number, lon: number, language: string, scale: string) => (
  `${lat.toFixed(3)},${lon.toFixed(3)},${language},${scale}`
);

const cache = new Map<string, string | null>();
const CACHE_MAX = 200;

/** The one request that matters is the latest one; the rest are stale taps. */
let inFlight: AbortController | null = null;

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

const ORDER: Record<GeocodeScale, Array<keyof Place>> = {
  local: ["city", "locality", "principalSubdivision", "countryName"],
  regional: ["principalSubdivision", "city", "countryName"],
  country: ["countryName", "principalSubdivision"],
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
  };
}

async function fromNominatim(
  lat: number,
  lon: number,
  language: string,
  scale: GeocodeScale,
  signal: AbortSignal,
): Promise<string | null> {
  if (!geocodingUrl) return null;
  const query = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    zoom: String(NOMINATIM_ZOOM[scale]),
    "accept-language": language,
  });
  const response = await fetch(`${geocodingUrl}/reverse?${query}`, { signal });
  if (!response.ok) return null;
  // A point with nothing around it is a 200 carrying `{"error": "Unable to
  // geocode"}`, not a 404, so the body has to be read to know there was a miss.
  const place = asPlace(await response.json() as NominatimResponse);
  return place ? pickLabel(place, scale) : null;
}

async function fromBigDataCloud(
  lat: number,
  lon: number,
  language: string,
  scale: GeocodeScale,
  signal: AbortSignal,
): Promise<string | null> {
  const url = `${BIGDATACLOUD_ENDPOINT}?latitude=${lat}&longitude=${lon}&localityLanguage=${language}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return pickLabel(await response.json() as Place, scale);
}

/**
 * The place at these coordinates, or null when there is no answer worth
 * showing. Never throws and never rejects: a missing label is a cosmetic loss,
 * and the strip has a perfectly good title without one.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  language = "en",
  scale: GeocodeScale = "local",
): Promise<string | null> {
  // Some locales arrive as "de-DE"; the API takes the bare language.
  const lang = language.slice(0, 2).toLowerCase();
  const key = cacheKey(lat, lon, lang, scale);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  return tracked("geocode", async () => {
    try {
      let label: string | null = null;
      try {
        label = await fromNominatim(lat, lon, lang, scale, controller.signal);
      } catch {
        // Ours being down is a reason to ask someone else, not to give up. An
        // abort is not: a newer tap is already in flight and owns the answer.
        if (controller.signal.aborted) return null;
      }
      label ??= await fromBigDataCloud(lat, lon, lang, scale, controller.signal);

      // Oldest out first. A session that taps 200 distinct places has long since
      // stopped caring about the first one.
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, label);
      return label;
    } catch {
      // Aborted, offline, rate-limited, malformed -- all the same to the caller.
      return null;
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  });
}

/** The scale a map at this zoom is really showing. */
export function scaleForZoom(zoom: number): GeocodeScale {
  if (zoom >= 9) return "local";
  if (zoom >= 6) return "regional";
  return "country";
}
