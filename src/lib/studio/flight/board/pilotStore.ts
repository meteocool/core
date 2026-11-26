/**
 * The pilot this browser flies as on the board: the credential the board
 * gave it, and its callsign. Kept in the page's own storage, so each site
 * (each environment) has its own pilot. The credential is never shown,
 * logged or put in an address; it goes only in the board's Authorization
 * header.
 */

export interface StoredPilot {
  pilot: string;
  callsign: string;
}

export const PILOT_KEY = "meteoair.pilot";

const CREDENTIAL = /^[0-9a-f]{32}$/;

/** What is kept as a pilot, where it reads as one; null for none, nonsense, or a browser that keeps nothing. */
export function readPilot(storage: Pick<Storage, "getItem"> | null): StoredPilot | null {
  try {
    const kept = JSON.parse(storage?.getItem(PILOT_KEY) ?? "null") as Partial<StoredPilot> | null;
    if (!kept || typeof kept.pilot !== "string" || !CREDENTIAL.test(kept.pilot) || typeof kept.callsign !== "string") return null;
    return { pilot: kept.pilot, callsign: kept.callsign.slice(0, 16) };
  } catch {
    return null;
  }
}

/** Keep a pilot; a browser that keeps nothing becomes a pilot again next time. */
export function keepPilot(storage: Pick<Storage, "setItem"> | null, pilot: StoredPilot): void {
  try {
    storage?.setItem(PILOT_KEY, JSON.stringify({ pilot: pilot.pilot, callsign: pilot.callsign }));
  } catch {
    // Kept for this page only.
  }
}

/** Forget the pilot: the board does not know it (storage from another site, or the board's own gone). */
export function forgetPilot(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(PILOT_KEY);
  } catch {
    // Nothing kept to forget.
  }
}
