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
