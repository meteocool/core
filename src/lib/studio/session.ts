/**
 * Going into meteocool Studio and coming back out.
 *
 * Studio borrows the 3D map: its peel becomes a setting of the scene's, which
 * a keyframe may put anywhere. Leaving hands it back as it was, so a reader
 * who only looked in finds the map they left; and with it the map's style,
 * if Studio left the storms in one only it offers (lib/cloudStyle.ts).
 */
import { get } from "svelte/store";
import { cloudStyle, peelLevel, peelManual } from "../../stores";
import { isMapStyle, mapStyleOf } from "../cloudStyle";
import { isHandheld } from "../gpuBudget";
import { studioOpen } from "./store";

/** The peel as the reader had it before Studio took it. */
let peelBefore: { manual: boolean; level: number } | null = null;

/**
 * Whether Studio's tools are offered: on a desktop. They are a panel, a
 * timeline and a pointer's precision, and a scene's scans are more volumes
 * than a phone's memory holds (lib/gpuBudget.ts).
 *
 * Not what the flight's own page asks (components/meteoair/Landing.svelte):
 * it opens Studio for the flight alone, on a phone as well. A flight needs
 * none of those tools, is flown by thumbs where there are no keys
 * (components/studio/flight/TouchControls.svelte), and holds the newest
 * scan's volumes and no other, as the 3D map does by itself.
 */
export const studioOffered = (): boolean => !isHandheld();

export function openStudio(): void {
  if (get(studioOpen)) return;
  peelBefore = { manual: get(peelManual), level: get(peelLevel) };
  studioOpen.set(true);
}

export function closeStudio(): void {
  if (!get(studioOpen)) return;
  studioOpen.set(false);
  if (peelBefore) {
    peelLevel.set(peelBefore.level);
    peelManual.set(peelBefore.manual);
  }
  peelBefore = null;
  // A style only Studio offers goes with it: the map is back in the reader's own.
  if (!isMapStyle(get(cloudStyle))) {
    cloudStyle.set(mapStyleOf(typeof window === "undefined" ? null : window.settings?.get("layer3dStyle")));
  }
}
