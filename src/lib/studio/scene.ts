/**
 * A Studio scene: what is on the 3D map at each moment of an animation.
 *
 * A scene is a short film of the map, so many seconds long, written as
 * keyframes: at this second the camera stands here, the section planes
 * there, the storms are drawn in this style, peeled this far, and are those
 * of this scan. Between
 * two keyframes everything moves from one to the other, and playing the
 * scene is asking it, frame after frame, what it holds at that second.
 *
 * The scan is a keyframe's like everything else, not the timeline itself: a
 * scene may run an hour of storms past a still camera, or turn the camera
 * round one scan held still, and both are two keyframes.
 *
 * No map and no stores here. The director (director.ts) plays a scene onto
 * the map; this is the arithmetic, which the tests and the links share.
 */
import { CLOUD_STYLES, DEFAULT_CLOUD_STYLE } from "../cloudStyle";
import type { CloudStyle } from "../cloudStyle";
import { foldDegrees } from "./planes";
import type { SectionPlane } from "./planes";

/** Between two scans of a radar composite, in seconds. */
const SCAN_SECONDS = 300;

/** The field of view the 3D map has outside Studio, in degrees: MapLibre's own. */
export const DEFAULT_FOV = 36.87;
/** As narrow and as wide as a lens goes here; see camera.ts. */
export const FOV_RANGE: [number, number] = [4, 75];
/** As far as the camera tilts in Studio: almost along the ground. */
export const STUDIO_MAX_PITCH = 89;

/** How long a new scene is, and how short and long one can be made, in seconds. */
export const DEFAULT_DURATION = 12;
export const DURATION_RANGE: [number, number] = [2, 120];

/** Two keyframes nearer than this, in seconds, are one: the newer replaces the older. */
export const SAME_MOMENT = 0.05;

/** Where the camera stands. `zoom` is MapLibre's own. */
export interface StudioCamera {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
  /** The lens: the vertical field of view, in degrees. */
  fov: number;
}

/** Everything a scene decides about the map at one moment. */
export interface SceneState {
  camera: StudioCamera;
  planes: SectionPlane[];
  /** 0 every storm whole to 1 down to its core. */
  peel: number;
  /** The scan the storms are from, epoch seconds; null for the newest, whatever it is by then. */
  scan: number | null;
  /** How the storms are drawn: a lit cloud, see-through light or nested shells (lib/cloudStyle.ts). */
  style: CloudStyle;
}

export interface Keyframe extends SceneState {
  /** When, in seconds from the start of the scene. */
  at: number;
}

export interface Scene {
  /** Seconds from the first frame to the last. */
  duration: number;
  /** In order of `at`, no two at the same moment. */
  keyframes: Keyframe[];
}

export const emptyScene = (): Scene => ({ duration: DEFAULT_DURATION, keyframes: [] });

const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);

/** The scene with this keyframe in it, in place of one already at that moment. */
export function withKeyframe(scene: Scene, keyframe: Keyframe): Scene {
  const at = clamp(keyframe.at, [0, scene.duration]);
  const kept = scene.keyframes.filter((other) => Math.abs(other.at - at) >= SAME_MOMENT);
  return { ...scene, keyframes: [...kept, { ...keyframe, at }].sort((a, b) => a.at - b.at) };
}

export function withoutKeyframe(scene: Scene, index: number): Scene {
  return { ...scene, keyframes: scene.keyframes.filter((_keyframe, at) => at !== index) };
}

/** The keyframe at this moment, if there is one; see `SAME_MOMENT`. */
export function keyframeAt(scene: Scene, at: number): number | null {
  const index = scene.keyframes.findIndex((keyframe) => Math.abs(keyframe.at - at) < SAME_MOMENT);
  return index < 0 ? null : index;
}

/**
 * The scene made so many seconds long, its keyframes keeping their place in
 * it: a scene stretched to twice the length plays the same film at half the
 * speed.
 */
export function withDuration(scene: Scene, seconds: number): Scene {
  const duration = clamp(seconds, DURATION_RANGE);
  const stretch = duration / scene.duration;
  return { duration, keyframes: scene.keyframes.map((keyframe) => ({ ...keyframe, at: keyframe.at * stretch })) };
}

/**
 * A value on its way from one keyframe to the next, eased by its neighbours.
 *
 * A cubic through the two, leaving and arriving at the pace the keyframes
 * either side of them set, so a camera passing through a keyframe does not
 * stop at it or turn a corner there. At the first and the last keyframe the
 * pace is nothing: a scene eases out of standing still and back into it.
 */
function eased(times: number[], values: number[], at: number): number {
  const last = times.length - 1;
  if (at <= times[0]) return values[0];
  if (at >= times[last]) return values[last];
  let i = 0;
  while (times[i + 1] < at) i += 1;
  const span = times[i + 1] - times[i];
  const pace = (k: number) => (k <= 0 || k >= last ? 0 : (values[k + 1] - values[k - 1]) / (times[k + 1] - times[k - 1]));
  const t = (at - times[i]) / span;
  const [t2, t3] = [t * t, t * t * t];
  return (2 * t3 - 3 * t2 + 1) * values[i]
    + (t3 - 2 * t2 + t) * span * pace(i)
    + (-2 * t3 + 3 * t2) * values[i + 1]
    + (t3 - t2) * span * pace(i + 1);
}

/**
 * Compass directions as one continuous turn: each the nearest way round from
 * the one before, so 350 then 10 is twenty degrees on, not 340 back.
 */
export function unwound(degrees: number[]): number[] {
  const out: number[] = [];
  for (const value of degrees) {
    const before = out.length ? out[out.length - 1] : value;
    out.push(before + (((value - before + 540) % 360 + 360) % 360) - 180);
  }
  return out;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** One plane on its way from a keyframe to the next: straight there, the short way round. */
function planeBetween(from: SectionPlane, to: SectionPlane, t: number): SectionPlane {
  const [facingFrom, facingTo] = unwound([from.facingDeg, to.facingDeg]);
  return {
    ...from,
    lon: mix(from.lon, to.lon, t),
    lat: mix(from.lat, to.lat, t),
    heightKm: mix(from.heightKm, to.heightKm, t),
    facingDeg: foldDegrees(mix(facingFrom, facingTo, t)),
    tiltDeg: mix(from.tiltDeg, to.tiltDeg, t),
    slabKm: from.slabKm !== null && to.slabKm !== null ? mix(from.slabKm, to.slabKm, t) : from.slabKm,
  };
}

/**
 * What the scene holds at this second; null for a scene with no keyframes,
 * which decides nothing.
 *
 * The camera and the peel ease through the keyframes. A plane moves straight
 * from one keyframe to the next where both have it, and otherwise is there
 * from the keyframe that has it on. The scan runs evenly between two
 * keyframes' scans and lands on the radar's own five-minute clock; from or
 * to "the newest" there is no clock to run on, so it holds until the next
 * keyframe. The style is one or another, and changes at the keyframe that
 * says so.
 */
export function sample(scene: Scene, at: number): SceneState | null {
  const { keyframes } = scene;
  if (!keyframes.length) return null;
  const times = keyframes.map((keyframe) => keyframe.at);
  const channel = (of: (keyframe: Keyframe) => number) => eased(times, keyframes.map(of), at);
  const bearings = unwound(keyframes.map((keyframe) => keyframe.camera.bearing));
  const camera: StudioCamera = {
    lon: channel((k) => k.camera.lon),
    lat: channel((k) => k.camera.lat),
    zoom: channel((k) => k.camera.zoom),
    pitch: clamp(channel((k) => k.camera.pitch), [0, STUDIO_MAX_PITCH]),
    bearing: foldDegrees(eased(times, bearings, at)),
    fov: clamp(channel((k) => k.camera.fov), FOV_RANGE),
  };

  // The keyframe at or before this second, and the one after it.
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1].at <= at) i += 1;
  const from = keyframes[i];
  const to = at > from.at ? keyframes[i + 1] : undefined;
  const t = to ? (at - from.at) / (to.at - from.at) : 0;

  const planes = from.planes.map((plane) => {
    const next = to?.planes.find((other) => other.id === plane.id);
    return next ? planeBetween(plane, next, t) : plane;
  });
  const scan = to && from.scan !== null && to.scan !== null
    ? Math.floor(mix(from.scan, to.scan, t) / SCAN_SECONDS + 1e-6) * SCAN_SECONDS
    : from.scan;
  return { camera, planes, peel: clamp(channel((k) => k.peel), [0, 1]), scan, style: from.style };
}

/**
 * Every scan a scene shows, in the order it first shows them, each with the
 * first second it is on screen: what has to be loaded before the scene can
 * play, and where the camera will be when each is.
 */
export function scansOf(scene: Scene, fps = 10): Array<{ scan: number | null; at: number }> {
  const seen = new Set<number | null>();
  const out: Array<{ scan: number | null; at: number }> = [];
  const frames = Math.max(1, Math.round(scene.duration * fps));
  for (let frame = 0; frame <= frames; frame += 1) {
    const at = (frame / frames) * scene.duration;
    const state = sample(scene, at);
    if (!state || seen.has(state.scan)) continue;
    seen.add(state.scan);
    out.push({ scan: state.scan, at });
  }
  return out;
}

/** A turn all the way round what the camera is looking at, at one moment held still. */
export function orbitScene(state: SceneState, duration = DEFAULT_DURATION): Scene {
  return {
    duration,
    keyframes: [0, 1, 2, 3].map((third) => ({
      ...state,
      at: (duration * third) / 3,
      camera: { ...state.camera, bearing: foldDegrees(state.camera.bearing + 120 * third) },
    })),
  };
}

/** The storms from one scan to another, past a camera that stays where it is. */
export function timelapseScene(state: SceneState, from: number, to: number, duration = DEFAULT_DURATION): Scene {
  return {
    duration,
    keyframes: [{ ...state, at: 0, scan: from }, { ...state, at: duration, scan: to }],
  };
}

/* A scene in a link: positional arrays, rounded to what a reader can tell
   apart, as base64 of their JSON. Versioned by its first element, so a link
   from a build that wrote them differently is refused rather than misread. */

const VERSION = 1;
const round = (value: number, places: number) => Number(value.toFixed(places));

type PackedPlane = [number, number, number, number, number, number, number, number];
type PackedState = [number, number, number, number, number, number, number, number, number, PackedPlane[]];
type PackedKeyframe = [number, ...PackedState];

function packState({ camera, planes, peel, scan, style }: SceneState): PackedState {
  return [
    round(camera.lon, 4), round(camera.lat, 4), round(camera.zoom, 2), round(camera.pitch, 1),
    round(camera.bearing, 1), round(camera.fov, 2), round(peel, 2), scan ?? 0, CLOUD_STYLES.indexOf(style),
    planes.map((plane) => [
      plane.id, round(plane.lon, 4), round(plane.lat, 4), round(plane.heightKm, 2), round(plane.facingDeg, 1),
      round(plane.tiltDeg, 1), plane.slabKm === null ? -1 : round(plane.slabKm, 2), plane.enabled ? 1 : 0,
    ]),
  ];
}

function unpackState(packed: unknown): SceneState | null {
  if (!Array.isArray(packed) || packed.length !== 10 || !Array.isArray(packed[9])) return null;
  const numbers = packed.slice(0, 9);
  if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const [lon, lat, zoom, pitch, bearing, fov, peel, scan, style] = numbers as number[];
  const planes: SectionPlane[] = [];
  for (const plane of packed[9] as unknown[]) {
    if (!Array.isArray(plane) || plane.length !== 8 || !plane.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return null;
    }
    const [id, planeLon, planeLat, heightKm, facingDeg, tiltDeg, slabKm, enabled] = plane as number[];
    planes.push({
      id, lon: planeLon, lat: planeLat, heightKm, facingDeg: foldDegrees(facingDeg), tiltDeg: clamp(tiltDeg, [-90, 90]),
      slabKm: slabKm < 0 ? null : slabKm, enabled: enabled !== 0,
    });
  }
  return {
    camera: {
      lon, lat, zoom, pitch: clamp(pitch, [0, STUDIO_MAX_PITCH]), bearing: foldDegrees(bearing), fov: clamp(fov, FOV_RANGE),
    },
    planes,
    peel: clamp(peel, [0, 1]),
    scan: scan > 0 ? scan : null,
    // One a newer build writes and this one does not know is drawn as the default.
    style: CLOUD_STYLES[style] ?? DEFAULT_CLOUD_STYLE,
  };
}

const toBase64Url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"));

/** What Studio holds, for a link: the scene, and the map as it stands for one with no keyframes. */
export interface StudioLink {
  still: SceneState;
  scene: Scene;
}

export function encodeStudio({ still, scene }: StudioLink): string {
  const keyframes: PackedKeyframe[] = scene.keyframes.map((keyframe) => [round(keyframe.at, 2), ...packState(keyframe)]);
  return toBase64Url(JSON.stringify([VERSION, packState(still), round(scene.duration, 2), keyframes]));
}

/** Null for anything that is not a scene this build wrote. */
export function decodeStudio(text: string): StudioLink | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed[0] !== VERSION || parsed.length !== 4) return null;
  const [, packedStill, duration, packedKeyframes] = parsed as [number, unknown, unknown, unknown];
  const still = unpackState(packedStill);
  if (!still || typeof duration !== "number" || !Number.isFinite(duration) || !Array.isArray(packedKeyframes)) return null;
  let scene: Scene = { duration: clamp(duration, DURATION_RANGE), keyframes: [] };
  for (const packed of packedKeyframes as unknown[]) {
    if (!Array.isArray(packed) || typeof packed[0] !== "number") return null;
    const state = unpackState(packed.slice(1));
    if (!state) return null;
    scene = withKeyframe(scene, { ...state, at: packed[0] });
  }
  return { still, scene };
}
