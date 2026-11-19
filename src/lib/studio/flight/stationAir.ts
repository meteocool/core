/**
 * The weather stations' air round a flight, asked of the backend: what
 * cloudBase.ts works the cloud base out from.
 */
import { fetchStationObservations } from "../../../api";
import { cloudBase } from "./cloudBase";
import type { CloudBase, StationAir } from "./cloudBase";

/** The stations' air, as last asked: every station reports at once, so one answer serves a whole flight for a while. */
let asked: { at: number; air: Promise<StationAir[]> } | null = null;
const ASK_AGAIN_MS = 10 * 60_000;

/** Every station's temperature and dew point now; none where the backend has no stations. */
function stationAir(): Promise<StationAir[]> {
  if (asked && Date.now() - asked.at < ASK_AGAIN_MS) return asked.air;
  const air = fetchStationObservations(["temperature_c", "dew_point_c"], null, 90).then(({ features }) => (
    features.flatMap(({ geometry, properties }): StationAir[] => {
      const { temperature_c: temperature, dew_point_c: dewPoint, elevation_m: elevation } = properties;
      if (typeof temperature !== "number" || typeof dewPoint !== "number") return [];
      return [{ lon: geometry.coordinates[0], lat: geometry.coordinates[1], elevation, temperature, dewPoint }];
    })
  ), () => []);
  asked = { at: Date.now(), air };
  return air;
}

/** The cloud base round a place, from the stations there now; null where they do not say. */
export async function cloudBaseAt(lon: number, lat: number): Promise<CloudBase | null> {
  return cloudBase(await stationAir(), lon, lat);
}
