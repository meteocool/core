/**
 * A flight taken off from the flat map: "Fly from here" (components/PointMenu.svelte),
 * or a track flown again (components/FlightTrackCard.svelte).
 *
 * Onto the 3D map looking at the start, into Studio, which takes off from
 * there at once without the flight's plan (`flightRequest`;
 * components/studio/Studio.svelte waits for the storms and chooses the
 * rest). The flight's code is Studio's and comes with it. When the flight
 * ends, the reader is back on the map they asked from, looking where they
 * were.
 */
import { get } from "svelte/store";
import { mapView, sharedActiveCap } from "../../stores";
import { FEATURES } from "../../features";
import { openStudio } from "./session";
import { flightRequest } from "./store";
import type { FlightRequest } from "./store";
import type { FlightStart } from "./flightLink";
import type { LayerManager } from "../LayerManager";
import type Cells3DCapability from "../../caps/Cells3DCapability";

/** The element every map is drawn into; see Map.svelte. */
const MAP_TARGET = "map";
/** The zoom the 3D map looks at a flight's start from while its storms come in. */
const FLY_ZOOM = 8;

const cells3dOf = (layerManager: LayerManager) => layerManager.getCapability("cells3d") as Cells3DCapability | undefined;

/**
 * Whether a flight can be taken off from the flat map now: where the 3D map,
 * which it flies over, can come up (not after it has failed to). On a phone
 * as well: a flight has controls for a touch screen. With `offered`, only
 * where this build offers the flight (features.ts); a track already flown is
 * flown again regardless, as its link would be.
 */
export function canFlyFromMap(layerManager: LayerManager, failed: boolean, offered = true): boolean {
  return (!offered || FEATURES.meteoair) && Boolean(cells3dOf(layerManager)) && !failed;
}

/** Take off from `start`, with what else the request says (a track to fly again). */
export function flyFromMap(layerManager: LayerManager, start: FlightStart, request: Omit<FlightRequest, "start" | "back"> = {}): void {
  const cells3d = cells3dOf(layerManager);
  if (!cells3d) return;
  const from = layerManager.currentCap ?? "radar";
  const was = get(mapView);
  flightRequest.set({
    ...request,
    start,
    back: () => {
      // Somewhere else by then (Back went there, say), which is where the reader is.
      if (get(sharedActiveCap) !== "cells3d") return;
      // The 3D map's camera first: the switch hands it to the flat map, and so
      // does any move of it still to be reported, such as the landing's.
      if (was) cells3d.setCamera({ lat: was.lat, lon: was.lon, zoom: was.zoom });
      layerManager.setTarget(from, MAP_TARGET);
    },
  });
  cells3d.setCamera({ lat: start.lat, lon: start.lon, zoom: FLY_ZOOM, pitch: 60, bearing: start.heading ?? 0 });
  layerManager.setTarget("cells3d", MAP_TARGET);
  openStudio();
}
