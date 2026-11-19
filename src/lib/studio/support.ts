/**
 * What the 3D map needs of Studio's code while Studio is open, handed to it
 * as Studio's panel comes up (`Stage.setStudioSupport`).
 *
 * Handed over rather than imported there: the 3D map is loaded by everyone
 * who opens it, and Studio only by those who go into it. Whatever the map
 * calls of Studio's it calls through this, so none of it is in the map's own
 * bundle. The flight has the same of its own (flight/support.ts).
 */
import { makeStudioPlanesLayer } from "../../layers/studioPlanesLayer";
import type { StudioSupport } from "./director";
import { clipPlanes, isLevel } from "./planes";

export const STUDIO_SUPPORT: StudioSupport = { makeStudioPlanesLayer, clipPlanes, isLevel };
