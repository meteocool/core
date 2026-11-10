import { get, readonly, writable } from "svelte/store";
import { mapView, selectedStorm, sharedActiveCap, stormDetails } from "../stores";
import type { MapView } from "../stores";
import type { RadarVolume } from "../api";
import { withVolume, type StormSelection } from "./stormSelection";

/**
 * Opening a storm on the 3D map from anywhere that shows one, and the way
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
 * ## The Way Back
 *
 * A storm opened this way was a detour: the reader was on the flat map, saw
 * a tag, and went to look at one storm. So the map and the view they came
 * from are kept here, for as long as they stay on the 3D map, and the 3D map
 * offers a button back to them (with the camera settling to nadir first; see
 * Cells3DCapability.leave). A 3D map picked from the switcher, or opened by a
 * link, is not a detour and has no button.
 *
 * Closing the storm used to take the reader back by itself. It surprised
 * them: they closed one storm to look at the next on the 3D map and were
 * dropped onto the flat one (November 2026). Going back is theirs to ask for
 * now, and they can ask at any time, a storm open or not.
 *
 * Moving the 3D map or picking another storm on it does not cancel the way
 * back; it only changes where to: from where the reader is
 * (Cells3DCapability reports it through `moved3D`), not the view they left,
 * which may be far away by then.
 */

/** Where a detour to the 3D map started, or null when the reader chose it. */
interface Origin {
  cap: string;
  /** The flat map's view at the time, for the camera to settle back onto. */
  view: MapView | null;
}

let switchTo3D: (() => void) | null = null;
let switchBack: ((cap: string) => void) | null = null;
const origin = writable<Origin | null>(null);

/** The map a detour started from, while one is under way: what the button back reads. */
export const detourOrigin = readonly(origin);

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
  origin.set(from && from !== "cells3d" ? { cap: from, view } : null);
}

/** Open a box of sky found in the composite, the 3D map's own kind, as a seed of its storm. */
export function openCloudIn3D(cloud: RadarVolume): void {
  if (!switchTo3D) return;
  selectedStorm.set(withVolume(get(selectedStorm), cloud));
  stormDetails.set(true);
  detour();
}

/**
 * Open a storm on the 3D map, cut open through its volume.
 *
 * The storm stays the selection: on the 3D map it is cut along its own
 * heading, and its details (the readings, the history) come with it.
 */
export function openStormIn3D(selection: StormSelection): void {
  if (!switchTo3D || !(selection.cell?.volume || selection.volume)) return;
  selectedStorm.set(selection);
  detour();
}

/** The map a detour started from, while one is under way. */
export function origin3D(): Origin | null {
  return get(origin);
}

/** The reader has chosen a map of their own; there is nothing to go back to. */
export function forget3DOrigin(): void {
  origin.set(null);
}

/** The reader has moved the 3D map: go back from where it is now. */
export function moved3D(): void {
  origin.update((from) => (from?.view ? { ...from, view: null } : from));
}

/** Go back to the map the detour started from. False when there was none. */
export function returnFrom3D(): boolean {
  const from = get(origin);
  origin.set(null);
  if (!from || !switchBack) return false;
  switchBack(from.cap);
  return true;
}
