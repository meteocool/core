import { chBorders, czBordersNearDwd, frBordersNearDwd, plBordersNearDwd } from "./extents";
import { maskPath } from "./tileMask";
import type { NetworkEvent } from "../api/events";

/**
 * A network, by the code the backend files it under. Not `dmax`, which is
 * DWD's and shares only the socket event.
 */
export type NetworkCode = Exclude<NetworkEvent["network"], "dmax">;

/**
 * DWD tiles with the EUMETNET networks' countries cut out of them.
 *
 * Inside those networks' borders their own layers are the ones that
 * should be on screen, and they cannot simply be stacked on top: every palette
 * here is part transparent, so DWD underneath would blend through into colours
 * neither radar measured. The overlap has to actually go away, and it cannot
 * go away by clipping the DWD layer: it is an `ol/layer/WebGLTile`, whose
 * render events carry a `WebGLRenderingContext` and no 2D context to call
 * `clip()` on.
 *
 * So the holes are punched into the tile images themselves, before OpenLayers
 * ever sees them (`valueTiles.ts`, through `tileMask.ts`, which the 3D map
 * cuts with too). That works whichever renderer draws them.
 *
 * Only tiles that actually meet a hole are touched; the rest are handed back
 * exactly as loaded, so this costs nothing for the vast majority of the grid.
 */

/** Every network's hole, with its bounding box for a cheap first test. Shared with the 3D map. */
export const HOLES = ([
  ["ch", chBorders],
  ["fr", frBordersNearDwd],
  ["cz", czBordersNearDwd],
  ["pl", plBordersNearDwd],
] as [NetworkCode, number[][][]][]).map(([code, rings]) => ({ code, ...maskPath(rings) }));

/** Every network: what the live frame is holed for. */
export const ALL_NETWORKS: NetworkCode[] = HOLES.map((hole) => hole.code);

/** A frame-to-holes map as one string, so an unchanged one is noticed as unchanged. */
export function holesSignature(holes: Map<string, NetworkCode[]>): string {
  return [...holes].map(([url, codes]) => `${url}=${codes.join(",")}`).join("|");
}
