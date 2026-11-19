/**
 * Going into meteocool Studio and coming back out.
 *
 * Studio borrows the 3D map: its peel becomes a setting of the scene's, which
 * a keyframe may put anywhere. Leaving hands it back as it was, so a reader
 * who only looked in finds the map they left.
 */
import { get } from "svelte/store";
import { peelLevel, peelManual } from "../../stores";
import { isHandheld } from "../gpuBudget";
import { studioOpen } from "./store";

/** The peel as the reader had it before Studio took it. */
let peelBefore: { manual: boolean; level: number } | null = null;

/**
 * Whether Studio is offered at all: on a desktop. Its tools are a panel, a
 * timeline and a pointer's precision, and a scene's scans are more volumes
 * than a phone's memory holds (lib/gpuBudget.ts).
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
}
