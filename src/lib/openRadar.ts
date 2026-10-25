import { get, writable } from "svelte/store";
import { siteMode, smallScreen, stormDetails } from "../stores";
import { fetchSweeps } from "../api";
import { RADAR_SITES, siteCode } from "./radarSites";

/**
 * Opening one radar's own sweeps (site mode, lib/SiteSweepManager.ts) from a
 * storm panel's list of the radars its volume was built from.
 *
 * Site mode is the flat map's, and switching maps is App's, as in
 * lib/open3d.ts: App registers the switch here and the panel asks for a
 * radar without knowing how. The storm stays selected: it is what a
 * storm-relative sweep is read against.
 */

let switchToFlat: (() => void) | null = null;

/** Whether this build can open a radar's sweeps at all; set with the switch. */
export const openRadarAvailable = writable(false);

export function registerOpenRadar(toFlat: () => void): void {
  switchToFlat = toFlat;
  openRadarAvailable.set(true);
}

/**
 * Which of these radars have sweeps to open, by one listing of the box they
 * stand in. Not every network publishes its sweeps; a row for one that does
 * not is not offered as a way in. Empty when the listing fails.
 */
export async function radarsWithSweeps(codes: readonly string[]): Promise<Set<string>> {
  const sites = codes.map((code) => RADAR_SITES[siteCode(code)]).filter(Boolean);
  if (!sites.length) return new Set();
  const pad = 0.1;
  const bbox: [number, number, number, number] = [
    Math.min(...sites.map((s) => s.lon)) - pad, Math.min(...sites.map((s) => s.lat)) - pad,
    Math.max(...sites.map((s) => s.lon)) + pad, Math.max(...sites.map((s) => s.lat)) + pad,
  ];
  const answer = await fetchSweeps({ bbox }).catch(() => null);
  return new Set((answer?.sites ?? []).map((site) => site.site));
}

/** Open a radar's sweeps on the flat map, at its lowest tilt; a phone's sheet makes way for it. */
export function openRadar(code: string): void {
  switchToFlat?.();
  const current = get(siteMode);
  // Elevation 0 is the lowest tilt (`tiltNear`).
  siteMode.set({ site: siteCode(code), quantity: current?.quantity ?? "reflectivity", elevation: 0 });
  if (get(smallScreen)) stormDetails.set(false);
}
