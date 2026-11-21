/**
 * Whether the live radar has a storm worth a flight, and where there is
 * none, the demo's recorded one instead (src/weatherSource.ts).
 *
 * Worth a flight is a thunderstorm: a system on the radar with a heavy core
 * and lightning going off in it. Rain alone is not. A November night over
 * Europe has plenty of rain and the odd 55 dBZ of sea clutter, and a flight
 * at it is grey cloud over the sea; the demo's storm is towers and lightning
 * over the Alps.
 *
 * Asked by the flight's page while the reader reads it, from the same lists
 * the 3D map loads: the composite's volumes, coarse, and the strikes of the
 * last minutes. A list that does not come says nothing either way, and the
 * page stays on its own weather.
 */
import { toLonLat } from "ol/proj";
import { fetchCurrentVolumes, fetchLightningStrikes } from "../../../api";
import { stormSystems, withStrikes } from "./spawn";
import type { StormSystem, Strike } from "./spawn";
import { STRIKE_WINDOW_MIN } from "./plan";

/** A core this strong, with lightning in it, is a thunderstorm, dBZ. */
export const WORTHY_DBZ = 45;
/** And this many strikes in it over `STRIKE_WINDOW_MIN` minutes: lightning going on, not one stray flash. */
export const WORTHY_STRIKES = 10;

/** Whether any of the systems is a thunderstorm worth flying at. */
export function worthFlying(systems: readonly Pick<StormSystem, "peakDbz" | "strikes">[]): boolean {
  return systems.some((system) => system.peakDbz >= WORTHY_DBZ && system.strikes >= WORTHY_STRIKES);
}

/** Whether the live radar has a storm worth flying at now; null where its lists did not come. */
export async function liveSkyWorthFlying(now = Date.now()): Promise<boolean | null> {
  try {
    const until = Math.floor(now / 1000);
    const [volumes, struck] = await Promise.all([
      fetchCurrentVolumes(undefined, { coarse: true }),
      fetchLightningStrikes(until - STRIKE_WINDOW_MIN * 60, until),
    ]);
    const tiles = (volumes.volumes ?? []).map((volume) => ({
      lon: volume.lon, lat: volume.lat, peakDbz: volume.peak_dbz ?? null, areaKm2: volume.area_km2 ?? null,
      coarse: Boolean(volume.coarse), tile: volume.tile ?? null,
    }));
    // In projected metres, as the map draws them.
    const strikes: Strike[] = struck.strikes.map((strike) => {
      const [lon, lat] = toLonLat([strike.lon, strike.lat]);
      return { lon, lat, at: strike.time_wall };
    });
    return worthFlying(withStrikes(stormSystems(tiles), strikes));
  } catch {
    return null;
  }
}
