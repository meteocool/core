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

/**
 * The pilot picked from the pins, whose card shows their aircraft close up
 * (closeUp.ts): whose it is, where on the flight's picture the card leaves
 * room for it, and what was drawn of it last frame.
 */
export interface CloseUpShared {
  /** The aircraft's number in the airspace; null while none is picked. */
  id: number | null;
  /**
   * Where the picture goes, as shares of the flight's picture from its top
   * left: across, down, wide and high. None to draw into while `w` is 0:
   * the card not laid out, or not up.
   */
  rect: { x: number; y: number; w: number; h: number };
  /** Last frame's: whose, with which model (none where nothing was drawn), the frames drawn since it was picked, the draw calls and the CPU's time, ms. */
  drawn: { callsign: string; model: "full" | "light" | "none"; frames: number; drawCalls: number; cpuMs: number };
}

export interface TrafficShared {
  traffic: Traffic;
  closeUp: CloseUpShared;
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
    closeUp: { id: null, rect: { x: 0, y: 0, w: 0, h: 0 }, drawn: { callsign: "", model: "none", frames: 0, drawCalls: 0, cpuMs: 0 } },
    labels: Array.from({ length: LABELS_MOST }, () => ({ shown: false, id: -1, x: 0, y: 0, distance: 0, altitude: 0, callsign: "" })),
    drawn: { models: 0, silhouettes: 0, lights: 0, trailSegments: 0, burning: 0, drawCalls: 0, cpuMs: 0 },
    charted: 0,
    renderer: "none",
  };
}

/**
 * Whether a box on the flight's picture (shares across and down: its left,
 * top, right and bottom) is over the close-up's picture, where nothing else
 * may be drawn on the page: the page's own drawing shows through it.
 */
export function overCloseUp(closeUp: CloseUpShared, left: number, top: number, right: number, bottom: number): boolean {
  const { rect } = closeUp;
  return closeUp.id !== null && rect.w > 0 && right > rect.x && left < rect.x + rect.w && bottom > rect.y && top < rect.y + rect.h;
}
