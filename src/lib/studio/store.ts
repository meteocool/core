/**
 * What meteocool Studio holds while it is open.
 *
 * Studio is a mode of the 3D map (Cells3DCapability), which draws what these
 * say: the section planes, the lens. The scene and where its playhead stands
 * are the director's (director.ts), which plays one onto the map.
 */
import { writable } from "svelte/store";
import { DEFAULT_FOV, emptyScene } from "./scene";
import type { Scene } from "./scene";
import type { SectionPlane } from "./planes";

/**
 * The basemap Studio opens on: the imagery, which is what a picture of
 * weather is taken over. Studio's own choice (the `studioBaseLayer` setting),
 * apart from the map's: a reader who likes their map plain keeps it plain,
 * and finds it so again on leaving Studio.
 */
export const STUDIO_BASEMAP = "satellite";

/** Whether the 3D map is in Studio. Only on a desktop; see `studioOffered`. */
export const studioOpen = writable<boolean>(false);

/** The section planes cutting the map, and the one being worked on, by its id. */
export const studioPlanes = writable<SectionPlane[]>([]);
export const studioSelectedPlane = writable<number | null>(null);

/** The lens: the camera's vertical field of view, in degrees. */
export const studioFov = writable<number>(DEFAULT_FOV);

/** The scene being made, and where in it the playhead stands, in seconds. */
export const studioScene = writable<Scene>(emptyScene());
export const studioPlayhead = writable<number>(0);
export const studioPlaying = writable<boolean>(false);

/** Scans being loaded for the scene before it plays: how many of how many; null when none are. */
export const studioLoading = writable<{ done: number; of: number } | null>(null);

/** A video being recorded: how far through the scene it is, 0 to 1; null when none is. */
export const studioRecording = writable<number | null>(null);

/** The shape a video is recorded in, as its frame over the map shows; see record.ts. */
export type Aspect = "window" | "16:9" | "1:1" | "9:16";
export const studioAspect = writable<Aspect>("16:9");

/**
 * Whether the reader is flying (lib/studio/flight): the 3D map seen from the
 * cockpit of an airliner, Studio's panel and timeline put away for the
 * flight deck.
 */
export const studioFlying = writable<boolean>(false);

/** Where a flight is seen from: the cockpit, outside the aircraft, or with no aircraft and nothing over the view. */
export type FlightView = "cockpit" | "outside" | "clean";

/** The warnings a flight sounds, by name. */
export type FlightWarning = "terrain" | "stall" | "overspeed" | "ice";

/**
 * What of a flight changes now and then rather than every frame: a store
 * per frame would redraw the deck sixty times a second. The instruments
 * read the pilot's telemetry each frame instead (lib/studio/flight/pilot.ts).
 */
export interface FlightStatus {
  view: FlightView;
  warnings: FlightWarning[];
  paused: boolean;
  recording: boolean;
  /** The keys card, shown on entry and on H. */
  keys: boolean;
  autopilot: boolean;
  warp: boolean;
  /** No storm on the radar to fly at. */
  clearSky: boolean;
  /** Below 2,500 ft over the ground: the radar altimeter reads out. */
  low: boolean;
  /** How the storm being looked into is opened (`Stage.inspectStorm`); null when none is. */
  inspecting: "cut" | "peel" | "xray" | null;
  /** The landing gear: up and locked, on its way, or down and locked (G). */
  gear: "up" | "moving" | "down";
}

export const INITIAL_FLIGHT_STATUS: FlightStatus = {
  view: "cockpit", warnings: [], paused: false, recording: false, keys: true, autopilot: false, warp: false,
  clearSky: false, low: false, inspecting: null, gear: "up",
};

export const flightStatus = writable<FlightStatus>(INITIAL_FLIGHT_STATUS);
