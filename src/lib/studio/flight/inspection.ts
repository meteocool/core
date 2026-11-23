/**
 * The storm looked into, as a link shared in flight carries it
 * (lib/studio/flightLink.ts, `FlightSnapshot`), and how the flight that takes
 * off from that link finds it again.
 *
 * What the sender had open is part of what they shared: the storm seen
 * through, cut open or peeled, and where the cut stood or how far the peel
 * went. A storm is named by where it was, since a mark has no id: the
 * receiver's flight looks into the marked storm nearest that place, one close
 * enough to be the same storm moved on, once the radar's storms are in and it
 * is marked. The cut keeps its compass facing and its depth, so it stands
 * across the storm as the sender set it.
 */
import type { InspectMode } from "../director";
import { CUT_PUSH_KM } from "./cut";
import type { CutSetting } from "./cut";
import { distanceM, wrap360 } from "./geo";
import { MARK_APART_KM } from "./marks";

/** The storm looked into, as a link has it. */
export interface SharedInspection {
  /** Where the storm was, the middle of its mark. */
  lon: number;
  lat: number;
  mode: InspectMode;
  /** Where the cut stood while it was cut open; null otherwise. */
  cut: (CutSetting & { facingDeg: number }) | null;
  /** How far a peeled storm is peeled, 0 to 1: the flight's peel, whichever way the storm was looked into; null where the link does not say. */
  peel: number | null;
}

/** The snapshot's key for it. */
export const INSPECTION_KEY = "inspect";

const MODES: readonly InspectMode[] = ["xray", "cut", "peel"];

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The inspection in a snapshot; null where it has none, or one in a shape this flight does not know. */
export function readInspection(snapshot: Record<string, unknown>): SharedInspection | null {
  const part = snapshot[INSPECTION_KEY];
  if (part === null || typeof part !== "object" || Array.isArray(part)) return null;
  const { lon, lat, mode, cut, peel } = part as Record<string, unknown>;
  if (!finite(lon) || !finite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const known = MODES.find((one) => one === mode);
  if (!known) return null;
  const setting = cut !== null && typeof cut === "object" ? (cut as Record<string, unknown>) : null;
  const placed = setting && finite(setting.facingDeg)
    ? {
      facingDeg: wrap360(setting.facingDeg),
      pushKm: finite(setting.pushKm) ? Math.min(Math.max(setting.pushKm, -CUT_PUSH_KM), CUT_PUSH_KM) : 0,
    }
    : null;
  return {
    lon, lat, mode: known,
    cut: known === "cut" ? placed : null,
    peel: finite(peel) ? Math.round(Math.min(Math.max(peel, 0), 1) * 100) / 100 : null,
  };
}

/**
 * The marked storm that is the one looked into: the nearest to where it was,
 * within `MARK_APART_KM`, closer than which two storms are one mark. Null
 * while none is.
 */
export function markFor<Mark extends { lon: number; lat: number }>(marks: readonly Mark[], wanted: { lon: number; lat: number }): Mark | null {
  let best: Mark | null = null;
  let bestM = MARK_APART_KM * 1000;
  for (const mark of marks) {
    const away = distanceM(wanted.lon, wanted.lat, mark.lon, mark.lat);
    if (away < bestM) [best, bestM] = [mark, away];
  }
  return best;
}
