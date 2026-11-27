/**
 * What the airspace's parts share on the flight deck: the aircraft heard
 * (traffic.ts), and what was drawn of them last frame, for the callsigns
 * over them, the chart, and whoever measures it.
 */
import type { Traffic } from "./traffic";

/** A pin over an aircraft: whose it is, where on the picture (0 to 1 across and down), how far off (m) and how high (m). */
export interface LabelSlot {
  shown: boolean;
  /** The aircraft's number in the airspace: what a pin picked stays with, as the pins change places. */
  id: number;
  x: number;
  y: number;
  distance: number;
  altitude: number;
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
  /** The pins over the aircraft this near, a handful at most, the nearest first. */
  labels: LabelSlot[];
  drawn: TrafficCounts;
  /** How many marks the chart drew of them, last time it drew. */
  charted: number;
  /** Whether what draws them, and their model, have been fetched. */
  renderer: "none" | "loading" | "ready" | "failed";
}

/** Aircraft this near, metres, have a pin over them, and this many at most: the nearest. */
export const LABEL_M = 150_000;
export const LABELS_MOST = 8;

export function sharedOf(traffic: Traffic): TrafficShared {
  return {
    traffic,
    labels: Array.from({ length: LABELS_MOST }, () => ({ shown: false, id: -1, x: 0, y: 0, distance: 0, altitude: 0, callsign: "" })),
    drawn: { models: 0, silhouettes: 0, lights: 0, trailSegments: 0, burning: 0, drawCalls: 0, cpuMs: 0 },
    charted: 0,
    renderer: "none",
  };
}
