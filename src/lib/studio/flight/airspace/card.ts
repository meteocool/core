/**
 * The card of a pilot picked from the pins over the other aircraft
 * (TrafficLabels.svelte): where on the deck it docks, how far off the
 * pilot is, and what they are doing, in a word. What its picture shows is
 * closeUp.ts's, which comes only with what draws the other aircraft.
 */
import type { OtherAircraft } from "./traffic";
import { ON_GROUND, PAUSED } from "./wire";

const wrap180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** A box on the deck, CSS pixels from its top left. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far a docked card keeps from the deck's edges and from what it keeps clear of, CSS pixels; and how finely its places are tried. */
export const DOCK_MARGIN = 12;
const DOCK_GAP = 8;
const DOCK_STEP = 8;

const overlap = (a: Box, b: Box, gap: number) => Math.max(0, Math.min(a.left + a.width, b.left + b.width + gap) - Math.max(a.left, b.left - gap))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height + gap) - Math.max(a.top, b.top - gap));

/**
 * Where a card `card` wide and high docks on a deck `area` wide and high:
 * the place clear of every box in `keepClear` (the readouts, the other
 * cards, the chart, the touch controls), as far right as there is, and of
 * those as low as there is; with as little of `rather` (the middle of the
 * view, where the flight's own aircraft is) under it as can be. Where no
 * place is clear, the one that covers the least. Its top left corner.
 */
export function dockPlace(
  area: { width: number; height: number }, card: { width: number; height: number }, keepClear: readonly Box[], rather?: Box,
): { left: number; top: number } {
  const right = area.width - DOCK_MARGIN - card.width;
  const bottom = area.height - DOCK_MARGIN - card.height;
  let best = { left: Math.max(DOCK_MARGIN, right), top: Math.max(DOCK_MARGIN, bottom) };
  let bestCovered = Infinity;
  let bestScore = Infinity;
  const box: Box = { left: 0, top: 0, width: card.width, height: card.height };
  for (let left = right; left >= DOCK_MARGIN - 0.5; left -= DOCK_STEP) {
    for (let top = bottom; top >= DOCK_MARGIN - 0.5; top -= DOCK_STEP) {
      box.left = left;
      box.top = top;
      let covered = 0;
      for (const clear of keepClear) covered += overlap(box, clear, DOCK_GAP);
      if (covered > bestCovered) continue;
      // Of the places as clear as each other: the least of the middle under it, then the furthest right, then the lowest.
      const score = (rather ? overlap(box, rather, 0) * 4 : 0) + (right - left) + (bottom - top) * 0.25;
      if (covered < bestCovered || score < bestScore) {
        best = { left, top };
        bestCovered = covered;
        bestScore = score;
      }
    }
  }
  return best;
}

const METRES_PER_DEGREE = 111_195;

/** How far apart two aircraft are, metres, near enough as a chart has it: over the ground and up or down. */
export function apart(a: { lon: number; lat: number; altitude: number }, b: { lon: number; lat: number; altitude: number }): number {
  const north = (b.lat - a.lat) * METRES_PER_DEGREE;
  const east = wrap180(b.lon - a.lon) * METRES_PER_DEGREE * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return Math.hypot(north, east, b.altitude - a.altitude);
}

/** What an aircraft is doing, as its card says it in a word: by what its look and its flags say, the worst first; null for flying along. */
export type Doing = "blew" | "broke" | "slid" | "burning" | "paused" | "ground" | null;

export function doingOf(aircraft: Pick<OtherAircraft, "look" | "shown">): Doing {
  const { look, shown } = aircraft;
  if (look.crash !== "none") return look.crash;
  if (look.burning) return "burning";
  if (shown.flags & PAUSED) return "paused";
  if (shown.flags & ON_GROUND) return "ground";
  return null;
}
