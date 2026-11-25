/**
 * Whether the radar has a storm worth a flight: now, or at a past moment.
 *
 * Worth a flight is a thunderstorm: a system on the radar with a heavy core
 * and lightning going off in it. Rain alone is not. A November night over
 * Europe has plenty of rain and the odd 55 dBZ of sea clutter, and a flight
 * at it is grey cloud over the sea. Where the live radar has none, the page
 * offers the strongest storm of the history instead (stormOfHistory.ts).
 *
 * Asked from the same lists the 3D map loads: the composite's volumes,
 * coarse, and the strikes of the minutes before. A list that does not come
 * says nothing either way.
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

/** Whether a system is a thunderstorm worth flying at. */
export const worthy = (system: Pick<StormSystem, "peakDbz" | "strikes">): boolean => (
  system.peakDbz >= WORTHY_DBZ && system.strikes >= WORTHY_STRIKES
);

/** Whether any of the systems is a thunderstorm worth flying at. */
export function worthFlying(systems: readonly Pick<StormSystem, "peakDbz" | "strikes">[]): boolean {
  return systems.some(worthy);
}

/**
 * The radar's storm systems with their lightning, at `at` (unix seconds) or
 * now where it is null; null where its lists did not come.
 */
export async function systemsAt(at: number | null = null, now = Date.now()): Promise<StormSystem[] | null> {
  try {
    const until = at ?? Math.floor(now / 1000);
    const [volumes, struck] = await Promise.all([
      fetchCurrentVolumes(undefined, { coarse: true, at }),
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
    return withStrikes(stormSystems(tiles), strikes);
  } catch {
    return null;
  }
}

/** Whether the live radar has a storm worth flying at now; null where its lists did not come. */
export async function liveSkyWorthFlying(now = Date.now()): Promise<boolean | null> {
  const systems = await systemsAt(null, now);
  return systems && worthFlying(systems);
}
