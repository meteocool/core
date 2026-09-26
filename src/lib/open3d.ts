import { get, writable } from "svelte/store";
import { mapView, selectedCell, selectedVolume, sharedActiveCap } from "../stores";
import type { MapView } from "../stores";
import type { CellTrackProperties, RadarVolume } from "../api";

/**
 * Opening a storm on the 3D map, from anywhere that shows one -- and the way
 * back.
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
 *
 * ## The way back
 *
 * A storm opened this way was a detour: the reader was on the flat map, saw
 * a tag, and went to look at one storm. Closing that storm on the 3D map is
 * the end of the detour, and the map they were on is where they expect to be
 * -- not a tilted 3D map they never asked for, with a layer switcher between
 * them and the radar. So the map and the view they came from are kept here,
 * for as long as they stay on the 3D map, and App takes them back when the
 * storm closes (with the camera settling to nadir first; see
 * Cells3DCapability.leave). A 3D map picked from the switcher, or opened by a
 * link, is not a detour and is left alone.
 */

/** Where a detour to the 3D map started, or null when the reader chose it. */
interface Origin {
  cap: string;
  /** The flat map's view at the time, for the camera to settle back onto. */
  view: MapView | null;
}

let switchTo3D: (() => void) | null = null;
let switchBack: ((cap: string) => void) | null = null;
let origin: Origin | null = null;

/** Whether this build has a 3D map to open anything on; set with the switch. */
export const open3DAvailable = writable(false);

export function registerOpen3D(open: () => void, back: (cap: string) => void): void {
  switchTo3D = open;
  switchBack = back;
  open3DAvailable.set(true);
}

/**
 * Switch, and remember where from.
 *
 * Recorded after the switch rather than before: App forgets the origin
 * whenever the active map is not the 3D one, which is also true for the
 * instant between the selection being set and the switch landing.
 */
function detour(): void {
  if (!switchTo3D) return;
  const from = get(sharedActiveCap);
  const view = get(mapView);
  switchTo3D();
  origin = from && from !== "cells3d" ? { cap: from, view } : null;
}

/** Open a storm core found in the composite: the 3D map's own kind. */
export function openCloudIn3D(cloud: RadarVolume): void {
  if (!switchTo3D) return;
  selectedCell.set(null);
  selectedVolume.set(cloud);
  detour();
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
  detour();
}

/** The map a detour started from, while one is under way. */
export function origin3D(): Origin | null {
  return origin;
}

/** The reader has chosen a map of their own; there is nothing to go back to. */
export function forget3DOrigin(): void {
  origin = null;
}

/** Go back to the map the detour started from. False when there was none. */
export function returnFrom3D(): boolean {
  const from = origin;
  origin = null;
  if (!from || !switchBack) return false;
  switchBack(from.cap);
  return true;
}
