/**
 * The demo's recorded storm, as the page shows it.
 *
 * The demo's backend has no live sky: what it keeps is one recorded storm,
 * a few hours long, answered as a past window (lib/archive.ts). So on the
 * demo's weather -- demo.meteocool.com, or a flight flown in the demo's
 * storm (src/weatherSource.ts) -- the page opens that window whole as soon
 * as it can, wherever a link has not opened one of its own, and stays in
 * it: there is no live to go back to.
 */
import { get } from "svelte/store";
import { archiveWindow } from "../stores";
import { demoBackend } from "../weatherSource";
import { wholeWindow } from "./archive";
import { loadCoverage } from "./archiveCoverage";

/** Whether this page's weather is the demo's recorded storm, which is only ever a past window. */
export const showcase = demoBackend;

/**
 * Open the demo's storm as the window on the map, unless a window is open
 * already. Whether one is open once it has answered.
 */
export async function openShowcase(): Promise<boolean> {
  if (!showcase) return false;
  if (get(archiveWindow)) return true;
  const coverage = await loadCoverage();
  const window = coverage ? wholeWindow(coverage) : null;
  if (get(archiveWindow)) return true;
  if (!window) return false;
  archiveWindow.set(window);
  return true;
}
