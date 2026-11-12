/**
 * Which one notice the player shows, of all that apply.
 *
 * There is one slot above the tray. The notices used to each decide for
 * themselves whether another was up, by exclusions written into the player
 * by hand, and two could stand at once (the feed's and the dry outlook).
 * Here every candidate is ranked once, in a fixed order, and a dismissed
 * one yields to the next:
 *
 * 1. a notice of ours for this view, `warning` first;
 * 2. no radar coverage;
 * 3. radar not arriving;
 * 4. forecast not arriving;
 * 5. no forecast here;
 * 6. the dry outlook.
 *
 * Pure: the player says what applies and what was dismissed.
 */
import type { ShownNotice } from "./status";

/** A condition the map works out for itself, as opposed to a notice of ours. */
export type Condition = "no-coverage" | "radar-stopped" | "forecast-stopped" | "no-forecast" | "dry-outlook";

/** What the slot shows. */
export type QueuedNotice = { kind: "ours"; notice: ShownNotice } | { kind: Condition };

/** What applies right now. */
export interface Candidates {
  /** Ours for this view, in the order `noticesFor` gives: `warning` first. */
  ours: readonly ShownNotice[];
  noCoverage: boolean;
  radarStopped: boolean;
  forecastStopped: boolean;
  noForecast: boolean;
  dryOutlook: boolean;
}

/** What a dismissal is kept by: a notice of ours by its id, a condition by its name. */
export const dismissalKey = (notice: QueuedNotice): string => (
  notice.kind === "ours" ? `ours:${notice.notice.id}` : notice.kind
);

/** Every candidate that applies, best first, dismissed or not. */
export function ranked(candidates: Candidates): QueuedNotice[] {
  const order: QueuedNotice[] = candidates.ours.map((notice) => ({ kind: "ours", notice }));
  if (candidates.noCoverage) order.push({ kind: "no-coverage" });
  if (candidates.radarStopped) order.push({ kind: "radar-stopped" });
  if (candidates.forecastStopped) order.push({ kind: "forecast-stopped" });
  /* Not while either feed is the reason there is no forecast, dismissed or
     not: "No Forecast Here" would then give the wrong one. */
  if (candidates.noForecast && !candidates.radarStopped && !candidates.forecastStopped) {
    order.push({ kind: "no-forecast" });
  }
  if (candidates.dryOutlook) order.push({ kind: "dry-outlook" });
  return order;
}

/** The one to show: the first that applies and was not dismissed, or none. */
export function nextNotice(candidates: Candidates, dismissed: ReadonlySet<string>): QueuedNotice | null {
  return ranked(candidates).find((notice) => !dismissed.has(dismissalKey(notice))) ?? null;
}

/**
 * The dismissals still to keep: a condition's goes once it no longer
 * applies, so coming back to it says so again; ours are kept by id for the
 * session, whatever applies.
 */
export function rearmed(dismissed: ReadonlySet<string>, candidates: Candidates): Set<string> {
  const applies: Record<Condition, boolean> = {
    "no-coverage": candidates.noCoverage,
    "radar-stopped": candidates.radarStopped,
    "forecast-stopped": candidates.forecastStopped,
    "no-forecast": candidates.noForecast,
    "dry-outlook": candidates.dryOutlook,
  };
  return new Set([...dismissed].filter((key) => key.startsWith("ours:") || applies[key as Condition]));
}
