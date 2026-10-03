/**
 * The backend, as typed calls generated from ng's OpenAPI schemas.
 *
 * Each wrapper keeps the two things every hand-written fetch here used to do
 * around the request -- drive the loading bar, and report a failure: to Sentry, and
 * to apiHealth, which is what the status pill reads -- so a caller cannot forget
 * either, and throws on a non-2xx rather than handing back an error body that
 * reads as a successful response.
 */
import { apiClient, dataClient } from "./client";
import { reportError } from "../lib/Toast";
import { apiHealth, reachability } from "../stores";
import { markAbsent, nextHealth } from "../lib/apiHealth";
import { answered, finished, started, unanswered } from "../lib/reachability";
import { progress } from "../lib/progress";
import { isTransient } from "../lib/timedFetch";
import { noteTransientFailure } from "../lib/recovery";
import type { components as ApiSchemas } from "./generated/api";
import type { components as DataSchemas } from "./generated/data";
import type { NetworkEvent } from "./events";

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
export type CellPlacement = DataSchemas["schemas"]["CellPlacement"];
export type CellStep = DataSchemas["schemas"]["CellStep"];
export type CellForecastPoint = DataSchemas["schemas"]["ForecastPoint"];
export type CellCurrent = DataSchemas["schemas"]["CellCurrent"];
export type CellLayer = DataSchemas["schemas"]["CellLayer"];
export type CellVolume = DataSchemas["schemas"]["CellVolume"];
export type RadarVolume = DataSchemas["schemas"]["RadarVolume"];
export type CurrentVolumes = DataSchemas["schemas"]["CurrentVolumes"];

/** The subset of NanobarWrapper these calls need. */
export interface Progress {
  start(id: string): void;
  finish(id: string): void;
}

/** Record what an endpoint just did; the rules are in lib/apiHealth.ts. */
function recordOutcome(id: string, error?: unknown) {
  apiHealth.update((health) => nextHealth(health, id, error));
}

/** What `openapi-fetch` hands back, including the response the status is on. */
interface Answer<T> {
  data?: T;
  error?: unknown;
  response?: Response;
}

/**
 * Whether a call may find nothing there without that being a fault.
 *
 * Some of what the map draws is published on a timer that has nothing to do
 * with this app, and answers 404 until its first capture lands. That is the
 * layer working as designed with nothing yet to show, and it was being counted
 * as a failed API call: the map went degraded, "Something went wrong" came up
 * over it, and both stayed for as long as the upstream had nothing -- which
 * for the Swiss composite is every restart of its ingest, and on a backend
 * without it at all, forever.
 *
 * `optional` only licenses the one answer that means absence. Anything else
 * from the same endpoint -- a 500, a timeout, a body that will not parse -- is
 * a failure and is reported as one, so switching this on cannot quietly hide a
 * route that is genuinely broken.
 */
interface RequestOptions {
  optional?: boolean;
}

/** The answer that means "there is nothing here", as opposed to "this broke". */
const isAbsence = (response: Response | undefined): boolean => response?.status === 404;

/**
 * An `optional` endpoint with nothing published yet.
 *
 * Still thrown, because the caller asked for something that is not there and
 * has nothing to draw either way -- every one of these call sites already
 * catches. A class rather than a message, so the wrapper's own handler can
 * tell it apart from a failure without reading strings, and so a caller that
 * wants to say "not captured yet" in its own words can too.
 */
export class NothingPublished extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(`${endpoint} has nothing published yet`);
    this.name = "NothingPublished";
    this.endpoint = endpoint;
  }
}

/**
 * How long to wait before each retry of a call that failed for the network's
 * sake. Two, so a blip -- a dropped connection, one stalled request, a
 * gateway that hiccupped -- is ridden out with the loading bar still moving
 * and nothing else to see. Anything longer is an outage, and lib/recovery.ts
 * is what comes back for it.
 */
export const RETRY_DELAYS_MS = [1000, 4000];

/** An HTTP answer that is not the data, kept with its status so it can be judged. */
class Refused extends Error {
  readonly status: number | undefined;

  constructor(id: string, status: number | undefined, error: unknown) {
    super(`${id} failed (${status ?? "no status"}): ${JSON.stringify(error)}`);
    this.name = "Refused";
    this.status = status;
  }
}

const transient = (error: unknown): boolean => (
  error instanceof Refused ? isTransient(error, error.status) : isTransient(error)
);

const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Send once, and say whether the backend was there: anything that came back
 * with a response was answered, a 500 included. Only a call that got nothing
 * at all -- refused by the network, or stalled -- counts against it, and only
 * when its caller has given up on it (`noAnswer`): a retry may yet get through.
 */
async function sendOnce<T>(send: () => Promise<Answer<T>>): Promise<Answer<T>> {
  const answer = await send();
  if (answer.response) reachability.update((r) => answered(r, Date.now()));
  return answer;
}

/** A call sent at `sentAt` has had its last try and got nothing back; see lib/reachability.ts. */
function noAnswer(error: unknown, sentAt: number) {
  if (!(error instanceof Refused) && transient(error)) {
    reachability.update((r) => unanswered(r, sentAt, Date.now()));
  }
}

const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The same call once more, quietly: no loading bar, no retries, no report.
 * True when it answered, which is recorded as the endpoint recovering.
 */
async function probe<T>(id: string, send: () => Promise<Answer<T>>, optional: boolean): Promise<boolean> {
  const sentAt = Date.now();
  reachability.update(started);
  try {
    const { data, error, response } = await sendOnce(send);
    if (error === undefined && data !== undefined) {
      recordOutcome(id);
      return true;
    }
    if (optional && isAbsence(response)) {
      apiHealth.update((health) => markAbsent(health, id));
      return true;
    }
  } catch (error) {
    // Still down; the next probe asks again.
    noAnswer(error, sentAt);
  } finally {
    reachability.update(finished);
  }
  return false;
}

async function request<T>(
  nanobar: Progress | undefined,
  id: string,
  send: () => Promise<Answer<T>>,
  { optional = false }: RequestOptions = {},
): Promise<T> {
  // The shared bar unless a caller brings its own: every request shows.
  const bar = nanobar ?? progress();
  bar.start(id);
  reachability.update(started);
  try {
    for (let attempt = 0; ; attempt += 1) {
      const sentAt = Date.now();
      try {
        const { data, error, response } = await sendOnce(send);
        if (error === undefined && data !== undefined) {
          recordOutcome(id);
          return data;
        }
        if (optional && isAbsence(response)) {
          apiHealth.update((health) => markAbsent(health, id));
          throw new NothingPublished(id);
        }
        throw new Refused(id, response?.status, error);
      } catch (error) {
        // An absence has already been recorded, and nobody is told the backend is
        // broken over it.
        if (error instanceof NothingPublished) throw error;
        /* Asked again only for what the network did, and not while the browser
           knows it is offline: that ends with an `online` event, and the wake
           it brings refetches everything anyway. */
        const again = RETRY_DELAYS_MS[attempt];
        if (again !== undefined && transient(error) && !offline()) {
          await pause(again);
          continue;
        }
        // Unreachable before failing, so the machine goes straight to offline
        // rather than by way of degraded (lib/connectionState.ts).
        noAnswer(error, sentAt);
        recordOutcome(id, error);
        if (transient(error)) {
          // The reader's network, not a fault of ours: a warning rather than a
          // Sentry report, and asked again until it answers (lib/recovery.ts).
          console.warn(error);
          noteTransientFailure(id, () => probe(id, send, optional));
        } else {
          reportError(error);
        }
        throw error;
      }
    }
  } finally {
    bar.finish(id);
    reachability.update(finished);
  }
}

/** Radar and nowcast tile metadata for each timestep in the current window. */
export function fetchRadarTimeseries(
  nanobar?: Progress,
  position?: { lat: number; lon: number; network?: NetworkEvent["network"] },
) {
  return request(nanobar, "/v3/radar/timeseries", () =>
    apiClient.GET("/v3/radar/timeseries", { params: { query: position ?? {} } }));
}

/** The most recent snowfield vector tile set. */
export function fetchSnowOverlay(nanobar?: Progress) {
  return request(nanobar, "/v3/radar/snow", () => apiClient.GET("/v3/radar/snow", {}));
}

/**
 * The most recent Swiss reflectivity composite -- one frame, not a timeseries.
 *
 * 404s until the first composite lands, same as `fetchPrecipitationTypes`
 * before anything has rendered; callers catch that the same way. `optional`,
 * because that 404 is the ingest's schedule rather than a broken backend and
 * has no business putting the map in its degraded state -- a backend with no
 * Swiss capture at all was otherwise reporting a permanent fault.
 */
export function fetchSwissRadar(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/switzerland",
    () => apiClient.GET("/v3/radar/switzerland", {}),
    { optional: true },
  );
}

/** The most recent French reflectivity composite; `optional` for the reason Switzerland's is. */
export function fetchFrenchRadar(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/france",
    () => apiClient.GET("/v3/radar/france", {}),
    { optional: true },
  );
}

/** The most recent Czech reflectivity composite; `optional` for the reason Switzerland's is. */
export function fetchCzechRadar(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/czechia",
    () => apiClient.GET("/v3/radar/czechia", {}),
    { optional: true },
  );
}

/** The most recent Polish reflectivity composite; `optional` for the reason Switzerland's is. */
export function fetchPolishRadar(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/poland",
    () => apiClient.GET("/v3/radar/poland", {}),
    { optional: true },
  );
}

/**
 * The most recent merged European composite -- every network's lowest tilts
 * on one grid, a product behind a setting; `optional` for the reason
 * Switzerland's is, and because an environment may not build it at all.
 */
export function fetchEuropeRadar(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/europe",
    () => apiClient.GET("/v3/radar/europe", {}),
    { optional: true },
  );
}

/** The most recent precipitation-type tile set, absent until one has rendered. */
export function fetchPrecipitationTypes(nanobar?: Progress) {
  return request(
    nanobar,
    "/v3/radar/classification",
    () => apiClient.GET("/v3/radar/classification", {}),
    { optional: true },
  );
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

/**
 * Every storm with a radar volume, from the newest composite scan.
 *
 * Found in the radar composite rather than in KONRAD3D, so most of these are
 * showers `/cells/current` never mentions -- which is the point of them: they
 * are the clouds a reader can cut open that no warning product would list.
 */
export function fetchCurrentVolumes(nanobar?: Progress) {
  return request(nanobar, "/cells/volumes", () => dataClient.GET("/cells/volumes", {}));
}

/**
 * One cell's complete history, for a detail view.
 *
 * `optional` for a code that came from a link rather than from the map: the
 * backend forgets tracks after a while and answers 404, and a link outliving
 * its storm is not the backend failing.
 */
export function fetchCellTrack(code: string, nanobar?: Progress, options: RequestOptions = {}) {
  return request(nanobar, "/cells/tracks/{code}", () =>
    dataClient.GET("/cells/tracks/{code}", { params: { path: { code } } }), options);
}
