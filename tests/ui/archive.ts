import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { FIXTURES, readRecording, type RecordedResponse } from "./offline";

/**
 * A backend with an archive, for the specs of a past window (lib/archive.ts).
 *
 * The recording has none: the fixtures ignore the query, and staging did not
 * serve the archive's routes when it was made. So each route is answered
 * here, synthesised from what was recorded: the timeline's observed frames
 * moved onto the window's steps, a few strikes in each piece asked for, no
 * snowfields and no precipitation types (a 404, as the backend gives a step
 * with none), the recorded storms. Without `start`, `until` or `at`, a
 * request is the live map's and goes on to the recording.
 */

const STEP_S = 300;
const DAY_S = 86_400;

interface Frame { upstream_time?: number | null; processed_time?: number; [key: string]: unknown }
interface Timeseries {
  frames: Record<string, Frame | null>;
  networks: Record<string, Record<string, Frame>>;
  server_time: number;
}

const recorded = (name: string): RecordedResponse =>
  JSON.parse(readFileSync(path.join(FIXTURES, "api", name), "utf8")) as RecordedResponse;

/** The recording's clock, unix seconds on the grid. */
export const RECORDED_STEP = (() => {
  const now = Math.floor(readRecording().recordedAt / 1000);
  return now - (now % STEP_S);
})();

/** What the archive covers: a month up to the step before the recording's. */
export const COVERAGE = { since: RECORDED_STEP - 30 * DAY_S, until: RECORDED_STEP - STEP_S, step_seconds: STEP_S, history_days: 31 };

/** The recorded timeline's observed frames, oldest first, and each network's. */
function observed(): { frames: Frame[]; networks: Record<string, Frame[]>; serverTime: number } {
  const json = recorded("GET_v3_radar_timeseries.json").json as Timeseries;
  const keys = Object.keys(json.frames)
    .filter((key) => json.frames[key]?.source === "observation")
    .sort((a, b) => Number(a) - Number(b));
  const networks: Record<string, Frame[]> = {};
  for (const [code, steps] of Object.entries(json.networks)) {
    networks[code] = Object.keys(steps).sort((a, b) => Number(a) - Number(b)).map((key) => steps[key]);
  }
  return { frames: keys.map((key) => json.frames[key]!), networks, serverTime: json.server_time };
}

/** A past window's timeline: the recorded frames, round and round, moved onto its steps. */
export function windowTimeseries(start: number, end: number): object {
  const { frames, networks, serverTime } = observed();
  const out: Timeseries & { products: object; replay: boolean } = {
    frames: {}, networks: {}, products: {}, server_time: serverTime, replay: false,
  };
  const moved = (frame: Frame, t: number): Frame => ({ ...frame, upstream_time: t, processed_time: t + 90, dbz: null });
  for (let t = start, i = 0; t <= end; t += STEP_S, i += 1) {
    out.frames[t] = moved(frames[i % frames.length], t);
    for (const [code, list] of Object.entries(networks)) {
      if (!list.length) continue;
      (out.networks[code] ??= {})[t] = moved(list[i % list.length], t);
    }
  }
  return out;
}

/** Three strikes in each ten minutes of a piece, in projected metres over central Germany. */
export function windowStrikes(since: number, until: number): object {
  const strikes = [];
  for (let t = since; t < until; t += 600) {
    for (let k = 0; k < 3; k += 1) {
      strikes.push({ lon: 1_050_000 + k * 5_000, lat: 6_530_000 + k * 4_000, time_wall: (t + k * 60) * 1000 });
    }
  }
  return { strikes, baseline: since };
}

/** What each archive request asked for, by path, with its query. */
export interface Asked { path: string; query: URLSearchParams }

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Answer the archive's routes on `page`, and record what was asked of them.
 * `empty`: the archive keeps nothing yet, which `/v3/archive` says with a 404.
 */
export async function serveArchive(page: Page, { empty = false }: { empty?: boolean } = {}): Promise<Asked[]> {
  const asked: Asked[] = [];
  const note = (url: URL) => asked.push({ path: url.pathname, query: url.searchParams });
  await page.route(/\/v3\/archive(\?|$)/, (route) => {
    note(new URL(route.request().url()));
    return empty ? json(route, { detail: "Nothing is kept yet" }, 404) : json(route, COVERAGE);
  });
  await page.route(/\/v3\/radar\/timeseries\?/, (route) => {
    const url = new URL(route.request().url());
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    if (!start || !end) return route.fallback();
    note(url);
    return json(route, windowTimeseries(start, end));
  });
  await page.route(/\/v3\/lightning\/strikes\?/, (route) => {
    const url = new URL(route.request().url());
    note(url);
    return json(route, windowStrikes(Number(url.searchParams.get("since")), Number(url.searchParams.get("until"))));
  });
  await page.route(/\/v3\/lightning\/stats\?/, (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("until")) return route.fallback();
    note(url);
    return json(route, { time: Number(url.searchParams.get("until")), bins: Array(30).fill(1), bin_size_min: 1 });
  });
  for (const product of ["snow", "classification"]) {
    await page.route(new RegExp(`/v3/radar/${product}\\?`), (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has("at")) return route.fallback();
      note(url);
      return json(route, { detail: "None measured then" }, 404);
    });
  }
  await page.route(/\/storms\?/, (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("until")) return route.fallback();
    note(url);
    return json(route, recorded("GET_storms.json").json);
  });
  return asked;
}

/** `20261104T1900Z`, as a link spells a step. */
export function linkTime(t: number): string {
  const iso = new Date(t * 1000).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}
