/**
 * What the flight's loading (preload.ts) does with the flight's own code,
 * once that is in: the aircraft's model and textures fetched and decoded,
 * and the sounds the flight makes up for itself made, so that none of it
 * waits for take-off. A chunk of its own, beside Studio's.
 */
import { loadAircraft } from "../../../layers/aircraftRenderer";
import { AIRCRAFT_FILES } from "./assets";
import { prepareSounds } from "./soundGraph";

/** Have the aircraft and the flight's sounds ready; `textures` hears how far the textures are, bytes. */
export async function warmFlight(textures: (loaded: number, total: number, known: boolean) => void): Promise<void> {
  prepareSounds();
  await loadAircraft(AIRCRAFT_FILES, textures);
}
