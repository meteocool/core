/**
 * What draws the other aircraft of the airspace, and the light model they
 * are drawn as: fetched only once the first of them has been heard, so a
 * flight with no one else in its sky fetches neither.
 */
import type { Pilot } from "../../../../lib/studio/flight/pilot";
import { AIRCRAFT_FILES } from "../../../../lib/studio/flight/assets";
import { LIGHT_MODEL, parseLightModel } from "../../../../lib/studio/flight/airspace/lightModel";
import type { TrafficShared } from "../../../../lib/studio/flight/airspace/shared";
import { makeTrafficPass } from "../../../../layers/trafficPass";

/** Fetch the model and hand the flight what draws `shared`'s aircraft with it; how to stop drawing them. */
export async function drawTraffic(pilot: Pilot, shared: TrafficShared): Promise<() => void> {
  const response = await fetch(`${AIRCRAFT_FILES}${LIGHT_MODEL}`);
  if (!response.ok) throw new Error(`light aircraft model: ${response.status}`);
  const model = parseLightModel(await response.arrayBuffer());
  const pass = makeTrafficPass({ shared, sight: () => pilot.sight, now: () => performance.now() }, model);
  pilot.setTraffic(pass);
  return () => {
    pilot.setTraffic(null);
    pass.dispose();
  };
}
