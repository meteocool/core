/**
 * What the airspace's parts share on the flight deck: the aircraft heard
 * (traffic.ts), and what was drawn of them last frame, for the callsigns
 * over them, the chart, and whoever measures it.
 */
import type { Traffic } from "./traffic";

/** A callsign over an aircraft: where on the picture (0 to 1 across and down), and how far off, m. */
export interface LabelSlot {
  shown: boolean;
  x: number;
  y: number;
  distance: number;
  callsign: string;
}

/** How many of each were drawn last frame, and the draw calls that took. */
export interface TrafficCounts {
  models: number;
  silhouettes: number;
  lights: number;
  trailSegments: number;
  burning: number;
  drawCalls: number;
  /** The CPU's time for the frame's work on them, ms. */
  cpuMs: number;
}

export interface TrafficShared {
  traffic: Traffic;
  /** The callsigns to show over aircraft this near, a handful at most, the nearest first. */
  labels: LabelSlot[];
  drawn: TrafficCounts;
  /** How many marks the chart drew of them, last time it drew. */
  charted: number;
  /** Whether what draws them, and their model, have been fetched. */
  renderer: "none" | "loading" | "ready" | "failed";
}

/** Callsigns are shown over aircraft this near, metres, and this many at most. */
export const LABEL_M = 5000;
export const LABELS_MOST = 6;

export function sharedOf(traffic: Traffic): TrafficShared {
  return {
    traffic,
    labels: Array.from({ length: LABELS_MOST }, () => ({ shown: false, x: 0, y: 0, distance: 0, callsign: "" })),
    drawn: { models: 0, silhouettes: 0, lights: 0, trailSegments: 0, burning: 0, drawCalls: 0, cpuMs: 0 },
    charted: 0,
    renderer: "none",
  };
}
