/**
 * The weather stations' air round a flight, asked of the backend: what
 * cloudBase.ts works the cloud base out from.
 */
import { get } from "svelte/store";
import { fetchStationObservations } from "../../../api";
import { archiveStep } from "../../../stores";
import { cloudBase } from "./cloudBase";
import type { CloudBase, StationAir } from "./cloudBase";

/**
 * The stations' air, as last asked, and for which moment (unix seconds, null
 * for now): every station reports at once, so one answer serves a whole
 * flight for a while.
 */
let asked: { askedAt: number; moment: number | null; air: Promise<StationAir[]> } | null = null;
const ASK_AGAIN_MS = 10 * 60_000;
/** Stations report every ten minutes: past moments this close share one answer, seconds. */
const SAME_MOMENT_S = 10 * 60;

/**
 * Every station's temperature and dew point at the moment the map shows: the
 * past window's step where one is open, else now; none where the backend has
 * no stations.
 */
function stationAir(): Promise<StationAir[]> {
  const step = get(archiveStep);
  const moment = step === null ? null : Math.floor(step / SAME_MOMENT_S) * SAME_MOMENT_S;
  if (asked && asked.moment === moment && (moment !== null || Date.now() - asked.askedAt < ASK_AGAIN_MS)) {
    return asked.air;
  }
  const at = step === null ? null : new Date(step * 1000);
  const air = fetchStationObservations(["temperature_c", "dew_point_c"], at, 90).then(({ features }) => (
    features.flatMap(({ geometry, properties }): StationAir[] => {
      const { temperature_c: temperature, dew_point_c: dewPoint, elevation_m: elevation } = properties;
      if (typeof temperature !== "number" || typeof dewPoint !== "number") return [];
      return [{ lon: geometry.coordinates[0], lat: geometry.coordinates[1], elevation, temperature, dewPoint }];
    })
  ), () => []);
  asked = { askedAt: Date.now(), moment, air };
  return air;
}

/** The cloud base round a place, from the stations there at the moment flown in; null where they do not say. */
export async function cloudBaseAt(lon: number, lat: number): Promise<CloudBase | null> {
  return cloudBase(await stationAir(), lon, lat);
}
