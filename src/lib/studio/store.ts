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
import type { FlightStart } from "./flightLink";

/**
 * The basemap Studio opens on: the imagery, which is what a picture of
 * weather is taken over. Studio's own choice (the `studioBaseLayer` setting),
 * apart from the map's: a reader who likes their map plain keeps it plain,
 * and finds it so again on leaving Studio.
 */
export const STUDIO_BASEMAP = "satellite";

/** Whether the 3D map is in Studio. Its tools only on a desktop (`studioOffered`); for the flight alone, anywhere. */
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

/**
 * Whether this page is for the flight alone (meteoair.html): Studio opens
 * straight on the flight's plan, with no panel or timeline of its own, and
 * the map the page opens on is the radar with nothing over it but that
 * page's own words. Set once by the page's entrypoint, before anything is
 * drawn.
 */
export const studioFlightOnly = writable<boolean>(false);

/**
 * A flight asked for from outside Studio, to start at once without its plan
 * being shown: "Fly from here" on the map (components/PointMenu.svelte), or
 * a flight's link (lib/studio/flightLink.ts). Set before Studio opens on the
 * 3D map; Studio waits there for the radar's storms, plans the flight from
 * the start (lib/studio/flight/plan.ts, `planHere`) and takes off, and puts
 * the request away once it has. `back` is where the reader goes when that
 * flight ends: the map they asked from; without it, wherever a flight ends
 * on that page. Closing Studio drops a request it has not flown yet.
 */
export interface FlightRequest {
  start: FlightStart;
  back?: () => void;
}
export const flightRequest = writable<FlightRequest | null>(null);

/** Where a flight is seen from: the cockpit, outside the aircraft, or with no aircraft and nothing over the view. */
export type FlightView = "cockpit" | "outside" | "clean";

/** The warnings a flight sounds, by name; the flaps or the gear jammed where they are by too much air are two of them. */
export type FlightWarning = "terrain" | "stall" | "overspeed" | "ice" | "gear" | "sink" | "bank" | "flapsJammed" | "gearJammed";

/**
 * Why a flight ended on the ground and not on its wheels (lib/studio/flight/physics.ts),
 * or before it got there (lib/studio/flight/damage.ts): pulled apart by more
 * load than the airframe bears, shaken apart by more speed, or a wing in
 * the ground; or that it did not touch down at all, but flew into it.
 */
export type FlightCrash = "terrain" | "gear" | "hard" | "attitude" | "fast" | "breakup" | "flutter" | "wing" | "impact";

/**
 * A surface that can flutter off the airframe well past its fastest speed
 * and leave the flight going (lib/studio/flight/damage.ts): each aileron,
 * each elevator, the rudder; each wing's outer spoiler panel, standing up as
 * the speed brake; and each wing's outer flap and outer slat, where they are
 * out.
 */
export type LostSurface =
  | "leftAileron" | "rightAileron" | "leftElevator" | "rightElevator" | "rudder"
  | "leftSpoiler" | "rightSpoiler" | "leftFlap" | "rightFlap" | "leftSlat" | "rightSlat";

/** An alarm of the flight (lib/studio/flight/alarms.ts): one of its warnings, or a surface it has lost, one each. */
export type FlightAlarm = FlightWarning | `lost.${LostSurface}`;

/**
 * A landing as it was made: how fast it came down, m/s, and how fast it was
 * going, m/s; what the gear felt, g; how far it has rolled since, metres;
 * and whether it has come to a stop.
 */
export interface FlightLanding {
  sink: number;
  speed: number;
  load: number;
  rolled: number;
  stopped: boolean;
}

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
  /** Where the flap lever is, 0 (in) to 4 (all the way out), and whether the flaps are still on their way there. */
  flaps: number;
  flapsMoving: boolean;
  /** The spoilers: flat, up as the speed brake, or all of them up on the ground after a landing. */
  spoilers: "in" | "brake" | "ground";
  /** On its wheels; the engines' thrust turned back; the engines held at full thrust for the angle of attack. */
  onGround: boolean;
  reverse: boolean;
  alphaFloor: boolean;
  /** The last landing, until the aircraft flies again; and why the flight just ended, for a moment after it has. */
  landing: FlightLanding | null;
  crash: FlightCrash | null;
  /** The surfaces that have come off in the air so far, in the order they went; the flight goes on without them. */
  lost: LostSurface[];
  /**
   * The alarms raised now, the surfaces lost first, as the master lights and
   * the chimes have them; none for what is left of an aircraft. And those of
   * them the reader has silenced (MASTER WARN, Q): not heard, and their light
   * out, until they clear.
   */
  alarms: FlightAlarm[];
  silenced: FlightAlarm[];
  /** The radar's colours painted on the ground under the storms (O); and the flight held while the reader is asked whether to end it. */
  radarOnGround: boolean;
  leaving: boolean;
}

export const INITIAL_FLIGHT_STATUS: FlightStatus = {
  view: "cockpit", warnings: [], paused: false, recording: false, keys: true, autopilot: false, warp: false,
  clearSky: false, low: false, inspecting: null, gear: "up", flaps: 0, flapsMoving: false, spoilers: "in", onGround: false,
  reverse: false, alphaFloor: false, landing: null, crash: null, lost: [], alarms: [], silenced: [], radarOnGround: false, leaving: false,
};

export const flightStatus = writable<FlightStatus>(INITIAL_FLIGHT_STATUS);
