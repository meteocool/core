/**
 * The flight's settings: what the reader has chosen to see while flying,
 * beyond what each flight's plan says, kept in this browser for every
 * flight after (components/studio/flight/FlightSettings.svelte shows them).
 *
 * A plan's choices (where to start, the storms marked, the radar on the
 * ground) belong to one flight and travel in its link. These are the
 * reader's own, the same on every flight, and a link does not carry them.
 */
import { writable } from "svelte/store";

export interface FlightSettings {
  /** Beams from the radars that saw a storm to its mark while it is looked into (radarRays.ts). */
  radarBeams: boolean;
}

/** As a first flight has them. */
export const DEFAULT_SETTINGS: FlightSettings = { radarBeams: false };

/** What the settings are kept under. */
export const SETTINGS_KEY = "meteoairSettings";

/**
 * The settings as they were kept: each one that was kept as it should be,
 * the rest as a first flight has them. A setting added since is off, and
 * one that has been taken out is forgotten.
 */
export function readSettings(kept: string | null): FlightSettings {
  let parsed: unknown = null;
  try {
    parsed = kept === null ? null : JSON.parse(kept);
  } catch {
    parsed = null;
  }
  const settings = { ...DEFAULT_SETTINGS };
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return settings;
  for (const name of Object.keys(DEFAULT_SETTINGS) as Array<keyof FlightSettings>) {
    const value = (parsed as Record<string, unknown>)[name];
    if (typeof value === "boolean") settings[name] = value;
  }
  return settings;
}

function stored(): FlightSettings {
  try {
    return readSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const flightSettings = writable<FlightSettings>(stored());

/** Change one setting, and keep it for the next flight. */
export function setFlightSetting<Name extends keyof FlightSettings>(name: Name, value: FlightSettings[Name]): void {
  flightSettings.update((settings) => {
    const next = { ...settings, [name]: value };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: for this visit only.
    }
    return next;
  });
}
