/**
 * A storm cell's name, as someone would say it out loud: "18 km N of Freising".
 *
 * The data service resolves each cell against a nearby place once and sends the
 * parts -- the place, an eight-point compass direction from it, and a distance
 * -- rather than a sentence. That split is deliberate and this file is the other
 * half of it: a panel header has room for the distance and a lineage node does
 * not, the app is bilingual, and only the client knows which of those it is
 * rendering.
 *
 * The place itself is never translated. It arrives in its local form
 * ("München", "Zürich"), which is what a chaser reading a road sign sees, and it
 * is resolved once per cell and shared by every viewer, so there is no second
 * language to have asked for.
 */

import type { CellPlacement } from "../api";

/** The translation function's shape, so this stays testable without a store. */
export type Translate = (key: string, options?: { values?: Record<string, string | number> }) => string;

/**
 * How much of the name there is room for.
 *
 * "long" is a panel header: "18 km N of Freising".
 * "short" is a graph node or a tooltip: "N of Freising".
 */
export type PlacementStyle = "long" | "short";

/** The eight-point compass the data service speaks, in its order. */
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/**
 * The cell's name, or null when it has none.
 *
 * Null is common and not an error: geocoding is off in an environment with no
 * geocoder of its own, and a cell far out to sea has no place to be named after.
 * Every caller already has something else to show -- the severity, the time --
 * so the absence needs no placeholder.
 */
export function placementLabel(
  placement: CellPlacement | null | undefined,
  t: Translate,
  style: PlacementStyle = "long",
): string | null {
  const place = placement?.place?.trim();
  if (!placement || !place) return null;

  // No direction means the cell is over the place -- within a few kilometres,
  // where "2 km NE of" would claim a precision the anchor does not have.
  const direction = placement.direction?.trim();
  if (!direction) return t("cell_place_over", { values: { place } });

  // A direction this file does not know is shown as sent rather than dropped:
  // it is still a compass abbreviation, and folding it into "over" would claim
  // the cell sits on the place when the server said otherwise.
  const compass = (COMPASS as readonly string[]).includes(direction)
    ? t(`compass_${direction}`)
    : direction;
  if (style === "short") {
    return t("cell_place_short", { values: { direction: compass, place } });
  }
  return t("cell_place_near", {
    values: { distance: Math.round(placement.distance_km), direction: compass, place },
  });
}
