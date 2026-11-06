/**
 * A mesocyclone as the map draws it, and as a tap finds the storm it turns in.
 *
 * DWD's detections name no storm, only a place and an intensity. A tap on
 * one is taken for the tracked storm nearest it, so that what a reader
 * reaches for when a storm rotates (its ring) opens that storm, and with it
 * the motion storm-relative velocity takes out.
 *
 * Pure: plain values in and out, so the unit tests can hold it.
 */
import { fromSite } from "./sweepGeometry";

/** The mark's size class by intensity, in the units the layer scales its icon by. */
export function mesoSize(intensity: number): number {
  if (intensity > 4) return 55;
  if (intensity > 3) return 46;
  if (intensity > 2) return 38;
  if (intensity > 1) return 30;
  return 22;
}

/** The icon's scale for an intensity. */
export const mesoScale = (intensity: number): number => 0.2 * (mesoSize(intensity) / 40);

/** The icon's width in its own pixels (assets/mesocyclone.png). */
const ICON_PX = 183;

/** How far from its centre the mark reaches on screen, px: a tap anywhere on the ring, or in it. */
export const mesoRadiusPx = (intensity: number): number => (ICON_PX * mesoScale(intensity)) / 2;

/**
 * How far from a storm's centre a mesocyclone may be and still be taken for
 * its own: a supercell's updraft sits within a few kilometres of the cell's
 * centroid, and the two are measured minutes apart.
 */
export const MESO_STORM_M = 15_000;

/** A storm still being tracked, where it is now. */
export interface LiveStorm {
  storm: string;
  coordinates: [number, number];
}

/** The tracked storm nearest a mesocyclone at `lon`, `lat`, within `withinM`; null with none that near. */
export function stormAtMesocyclone(storms: LiveStorm[], lon: number, lat: number, withinM = MESO_STORM_M): string | null {
  let best: string | null = null;
  let bestM = withinM;
  for (const { storm, coordinates: [stormLon, stormLat] } of storms) {
    const { groundM } = fromSite(stormLon, stormLat, lon, lat);
    if (groundM <= bestM) {
      best = storm;
      bestM = groundM;
    }
  }
  return best;
}
