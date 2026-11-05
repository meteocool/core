/**
 * meteocool's rotation signatures, as the `mesocyclones` list carries them
 * beside DWD's detections: a radar's velocity rotating at several tilts,
 * read off the dealiased velocity.
 * Not a mesocyclone: the velocity shears here at these tilts, with its
 * rotational velocity, depth and range, and no more is claimed.
 *
 * Pure: what the point menu and the storm panel say of one, and which one
 * is near a point, so the unit tests can hold it.
 */

/** One signature as `/mesocyclones/all/` lists it; `lat` and `lon` are EPSG:3857 metres, as DWD's detections'. */
export interface RotationSignature {
  source: "meteocool";
  lat: number;
  lon: number;
  time: number;
  site: string;
  network: string;
  scanned_at: number;
  vrot_m_s?: number | null;
  shear_max: number;
  tilts_deg: number[];
  heights_m: number[];
  range_km: number;
  persistent: boolean;
  agrees_with_dwd?: boolean | null;
}

/** Anything the `mesocyclones` list carries: DWD's detection or ours, told apart by `source`. */
export interface Detection {
  source?: "dwd" | "meteocool";
  lat: number;
  lon: number;
  time: number;
  [key: string]: unknown;
}

const MERCATOR_RADIUS_M = 6378137;
const EARTH_RADIUS_KM = 6371;

/** Ours, out of a payload of both. */
export function signaturesOf(detections: Detection[]): RotationSignature[] {
  return detections.filter((d): d is RotationSignature & Detection => d.source === "meteocool") as RotationSignature[];
}

/** A projected point back to degrees, [lon, lat]. */
export function toDegrees(easting: number, northing: number): [number, number] {
  const lon = (easting / MERCATOR_RADIUS_M) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(northing / MERCATOR_RADIUS_M)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** The signature nearest a point in degrees, within `withinKm` of it, else null. */
export function nearestSignature(
  signatures: RotationSignature[], lat: number, lon: number, withinKm: number,
): { signature: RotationSignature; km: number } | null {
  let best: { signature: RotationSignature; km: number } | null = null;
  for (const signature of signatures) {
    const [sLon, sLat] = toDegrees(signature.lon, signature.lat);
    const km = distanceKm(lat, lon, sLat, sLon);
    if (km <= withinKm && (!best || km < best.km)) best = { signature, km };
  }
  return best;
}

/** What is said of a signature, line by line: `t` is the app's translate. */
export function describeSignature(
  signature: RotationSignature,
  t: (key: string, options?: { values?: Record<string, string | number> }) => string,
): string[] {
  const tilts = signature.tilts_deg;
  const heights = signature.heights_m;
  const lines = [
    t("signature.depth", {
      values: {
        count: tilts.length,
        lowest: (Math.min(...heights) / 1000).toFixed(1),
        highest: (Math.max(...heights) / 1000).toFixed(1),
      },
    }),
    t("signature.range", { values: { range: Math.round(signature.range_km), site: signature.site.toUpperCase() } }),
  ];
  if (signature.vrot_m_s !== null && signature.vrot_m_s !== undefined) {
    lines.unshift(t("signature.vrot", { values: { value: signature.vrot_m_s.toFixed(1) } }));
  }
  if (signature.persistent) lines.push(t("signature.persistent"));
  if (signature.agrees_with_dwd === true) lines.push(t("signature.agrees"));
  else if (signature.agrees_with_dwd === false) lines.push(t("signature.disagrees"));
  return lines;
}
