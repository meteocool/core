/**
 * Turning a tapped coordinate into a place name for the forecast strip's title.
 *
 * NOT Open-Meteo, which was the ask: their geocoding API only goes forwards.
 * /v1/search wants a `name` and refuses coordinates, /v1/get wants an id, and
 * there is no /v1/reverse -- all three answer 404 or "No value found at 'name'".
 *
 * BigDataCloud's reverse-geocode-client is the closest fit: no key, CORS open
 * to any origin, and it is the endpoint they publish specifically for calls
 * made from a browser. The alternatives were worse for a map people tap at
 * random -- Nominatim's terms want one request a second and an identifying
 * User-Agent a browser cannot set, and both it and Photon return nothing at all
 * a few kilometres offshore, which on a rain radar is an ordinary place to tap.
 *
 * Everything provider-shaped is in this file: the endpoint, the response shape,
 * and which of its fields become the label. Swapping providers is those three.
 */

const ENDPOINT = "https://api.bigdatacloud.net/data/reverse-geocode-client";

/** The fields of the response this reads. Everything else is ignored. */
interface ReverseGeocodeResponse {
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

const ORDER: Record<GeocodeScale, Array<keyof ReverseGeocodeResponse>> = {
  local: ["city", "locality", "principalSubdivision", "countryName"],
  regional: ["principalSubdivision", "city", "countryName"],
  country: ["countryName", "principalSubdivision"],
};

function pickLabel(body: ReverseGeocodeResponse, scale: GeocodeScale): string | null {
  for (const field of ORDER[scale]) {
    const value = body[field]?.trim();
    if (value) return value;
  }
  return null;
}

/** The scale a map at this zoom is really showing. */
export function scaleForZoom(zoom: number): GeocodeScale {
  if (zoom >= 9) return "local";
  if (zoom >= 6) return "regional";
  return "country";
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

  try {
    const url = `${ENDPOINT}?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const label = pickLabel(await response.json() as ReverseGeocodeResponse, scale);
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
}
