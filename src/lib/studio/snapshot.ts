/**
 * A moment of a flight, as a link shared in flight carries it
 * (lib/studio/flightLink.ts): whatever the flight put in, as JSON in
 * base64url under `s`. Read back as it is, unchecked past being an object;
 * the flight takes from it what it knows (lib/studio/flight/pilot.ts,
 * `resume`), and the page whose weather it was flown in (src/weatherSource.ts,
 * `weather`).
 *
 * On its own and importing nothing, so the page can read it before it has
 * settled anything else.
 */
export type FlightSnapshot = Record<string, unknown>;

/** The query's key for a snapshot. */
export const SNAPSHOT_KEY = "s";

/** A snapshot as JSON in base64url: UTF-8, no padding. */
export function writeSnapshot(snapshot: FlightSnapshot): string {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A snapshot back from its base64url; null for nothing, or for anything that is not a JSON object. */
export function readSnapshot(text: string | null | undefined): FlightSnapshot | null {
  if (!text) return null;
  try {
    const binary = atob(text.trim().replace(/-/g, "+").replace(/_/g, "/"));
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as FlightSnapshot) : null;
  } catch {
    return null;
  }
}
