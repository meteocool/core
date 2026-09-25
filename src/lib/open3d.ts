import { writable } from "svelte/store";
import { selectedCell, selectedVolume } from "../stores";
import type { CellTrackProperties, RadarVolume } from "../api";

/**
 * Opening a storm on the 3D map, from anywhere that shows one.
 *
 * Switching maps is the layer manager's, and the layer manager is App's; the
 * panels that want to offer "see this in 3D" are several components down and
 * never had it. So App registers the switch here once, and a panel asks for
 * a storm to be opened without knowing how.
 *
 * The selection is set before the switch in every case: the 3D map ignores
 * selections while hidden and opens whatever is selected when it attaches,
 * so the volume is fetched once. Set the other way round, the store's own
 * subscriber and the attach each started a fetch of it.
 */

let switchTo3D: (() => void) | null = null;

/** Whether this build has a 3D map to open anything on; set with the switch. */
export const open3DAvailable = writable(false);

export function registerOpen3D(open: () => void): void {
  switchTo3D = open;
  open3DAvailable.set(true);
}

/** Open a storm core found in the composite: the 3D map's own kind. */
export function openCloudIn3D(cloud: RadarVolume): void {
  if (!switchTo3D) return;
  selectedCell.set(null);
  selectedVolume.set(cloud);
  switchTo3D();
}

/**
 * Open a tracked cell on the 3D map, cut open through the volume paired with it.
 *
 * The cell stays the selection rather than being traded for its volume: on
 * the 3D map a cell is cut along its own heading, and its details -- the
 * readings, the history -- come with it.
 */
export function openCellIn3D(track: CellTrackProperties): void {
  if (!switchTo3D || !track.volume) return;
  selectedVolume.set(null);
  selectedCell.set(track);
  switchTo3D();
}
