import { modelCompareAt, selectedCell, selectedVolume } from "../stores";

/**
 * Open the model comparison for a point, in the storm drawer's place.
 *
 * Whatever storm was open there goes: the drawer holds one thing at a time,
 * as it does when a second storm is tapped. `hours` is the spread's range to
 * open on (24 or 168) and defaults to the day.
 */
export function openModelCompare(lat: number, lon: number, hours?: number): void {
  selectedCell.set(null);
  selectedVolume.set(null);
  modelCompareAt.set({ lat, lon, hours });
}
