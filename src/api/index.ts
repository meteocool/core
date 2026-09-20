/**
 * The backend, as typed calls generated from ng's OpenAPI schemas.
 *
 * Each wrapper keeps the two things every hand-written fetch here used to do
 * around the request -- drive the nanobar, and report a failure through Toast --
 * so a caller cannot forget either, and throws on a non-2xx rather than handing
 * back an error body that reads as a successful response.
 */
import { apiClient, dataClient } from "./client";
import { reportError } from "../lib/Toast";
import { apiHealth } from "../stores";
import { nextHealth } from "../lib/apiHealth";
import type { components as ApiSchemas } from "./generated/api";
import type { components as DataSchemas } from "./generated/data";

type Schemas = ApiSchemas["schemas"];

export type RadarFrame = Schemas["RadarFrame"];
export type RadarFrames = Schemas["RadarFrames"];
export type VectorOverlay = Schemas["VectorOverlay"];
export type PrecipitationTypes = Schemas["PrecipitationTypes"];
export type LightningLayerMetadata = Schemas["LightningLayerMetadata"];
export type LightningCollection = Schemas["LightningCollection"];
export type LightningStats = Schemas["LightningStats"];
export type Strike = DataSchemas["schemas"]["Strike"];
export type Mesocyclone = DataSchemas["schemas"]["Mesocyclone"];
export type CellTrack = DataSchemas["schemas"]["TrackFeature"];
export type CellTrackProperties = DataSchemas["schemas"]["TrackProperties"];
export type CellStep = DataSchemas["schemas"]["CellStep"];
export type CellForecastPoint = DataSchemas["schemas"]["ForecastPoint"];
export type CellCurrent = DataSchemas["schemas"]["CellCurrent"];
export type CellLayer = DataSchemas["schemas"]["CellLayer"];

/** The subset of NanobarWrapper these calls need. */
export interface Progress {
  start(id: string): void;
  finish(id: string): void;
}

/** Record what an endpoint just did; the rules are in lib/apiHealth.ts. */
function recordOutcome(id: string, error?: unknown) {
  apiHealth.update((health) => nextHealth(health, id, error));
}

async function request<T>(nanobar: Progress | undefined, id: string, send: () => Promise<{ data?: T; error?: unknown }>): Promise<T> {
  nanobar?.start(id);
  try {
    const { data, error } = await send();
    if (error !== undefined || data === undefined) {
      throw new Error(`${id} failed: ${JSON.stringify(error)}`);
    }
    recordOutcome(id);
    return data;
  } catch (error) {
    recordOutcome(id, error);
    reportError(error);
    throw error;
  } finally {
    nanobar?.finish(id);
  }
}

/** Radar and nowcast tile metadata for each timestep in the current window. */
export function fetchRadarTimeseries(nanobar?: Progress, position?: { lat: number; lon: number }) {
  return request(nanobar, "/v3/radar/timeseries", () =>
    apiClient.GET("/v3/radar/timeseries", { params: { query: position ?? {} } }));
}

/** The most recent snowfield vector tile set. */
export function fetchSnowOverlay(nanobar?: Progress) {
  return request(nanobar, "/v3/radar/snow", () => apiClient.GET("/v3/radar/snow", {}));
}

/** The most recent precipitation-type tile set. */
export function fetchPrecipitationTypes(nanobar?: Progress) {
  return request(nanobar, "/v3/radar/classification", () => apiClient.GET("/v3/radar/classification", {}));
}

/** The most recent lightning vector tile set. */
export function fetchLightningLayer(nanobar?: Progress) {
  return request(nanobar, "/v3/lightning/layer", () => apiClient.GET("/v3/lightning/layer", {}));
}

/** Every strike recorded since `baseline`, as a unix timestamp in seconds. */
export function fetchLightningSince(baseline: number, nanobar?: Progress) {
  return request(nanobar, "/v3/lightning/baseline", () =>
    apiClient.GET("/v3/lightning/baseline", { params: { query: { baseline } } }));
}

/**
 * Per-minute strike counts inside `polygon`, for the last half hour.
 *
 * The endpoint takes the polygon as a JSON-encoded string rather than a
 * structured parameter, so the encoding lives here instead of at every call.
 */
export function fetchLightningStats(polygon: number[][], nanobar?: Progress) {
  return request(nanobar, "/v3/lightning/stats", () =>
    apiClient.GET("/v3/lightning/stats", {
      params: { query: { bbox: JSON.stringify({ coordinates: polygon }) } },
    }));
}

/** Recent strikes, so a map that has just loaded can backfill. */
export function fetchLightningCache(nanobar?: Progress) {
  return request(nanobar, "/lightning_cache", () => dataClient.GET("/lightning_cache", {}));
}

/** Every currently active mesocyclone detection. */
export function fetchMesocyclones(nanobar?: Progress) {
  return request(nanobar, "/mesocyclones/all/", () => dataClient.GET("/mesocyclones/all/", {}));
}

/**
 * Cell tracks inside a viewport.
 *
 * Both bounds are sent every time. The window keeps a severe afternoon from
 * returning every storm of the day, and the viewport keeps it from returning
 * every storm in the country -- either alone leaves a response that a phone on
 * a mobile connection would rather not have.
 */
export function fetchCellTracks(
  bbox: [number, number, number, number],
  sinceMinutes: number,
  nanobar?: Progress,
) {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  return request(nanobar, "/cells/tracks", () =>
    dataClient.GET("/cells/tracks", {
      params: { query: { bbox: bbox.map((value) => value.toFixed(3)).join(","), since } },
    }));
}

/** Every cell in the most recent KONRAD3D run, with its forecast centroids. */
export function fetchCurrentCells(nanobar?: Progress) {
  return request(nanobar, "/cells/current", () => dataClient.GET("/cells/current", {}));
}

/** One cell's complete history, for a detail view. */
export function fetchCellTrack(code: string, nanobar?: Progress) {
  return request(nanobar, "/cells/tracks/{code}", () =>
    dataClient.GET("/cells/tracks/{code}", { params: { path: { code } } }));
}
