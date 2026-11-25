/**
 * When a flight on the flight's page is flown, as its plan asks
 * (components/studio/flight/Preflight.svelte): the radar's now, a past
 * moment the archive keeps (lib/archive.ts), or the recorded storm
 * (src/weatherSource.ts), which the page is on unasked where the live sky
 * has no thunderstorm (lib/studio/flight/fallback.ts).
 *
 * A past moment opens a past window ending on it, which the 3D map, its
 * radar and its strikes then answer for; the page says so only in the plan.
 * The recorded storm is another backend, settled as a page loads: onto it
 * or off it, the page loads again and goes straight back on to the plan
 * (`board`), at the moment chosen where one was.
 */
import { get } from "svelte/store";
import { archiveWindow } from "../../../stores";
import { demoWeather, WEATHER_KEY } from "../../../weatherSource";
import { onGrid, windowAround } from "../../archive";
import type { ArchiveCoverage, ArchiveWindow } from "../../archive";
import { loadCoverage } from "../../archiveCoverage";
import { readMoment, writeMoment } from "../flightLink";
import { curtainDown, lower } from "../../curtain";

export type FlightWhen = { kind: "now" } | { kind: "storm" } | { kind: "past"; at: number };

/** On the address, to go straight on to the plan once the page has loaded: `1` in the radar's now, or a past moment. */
export const BOARD_KEY = "board";

/** The time of day the plan offers on a day picked: late afternoon, when thunderstorms are at their height. */
export const DEFAULT_MINUTE = 16 * 60;

/** When the page's flight is flown, from its weather and the window open on it. */
export function whenOf(demo: boolean, past: ArchiveWindow | null, step: number | null): FlightWhen {
  if (demo) return { kind: "storm" };
  return past && step !== null ? { kind: "past", at: step } : { kind: "now" };
}

/**
 * The moment at `minute` of a day's clock, `clock(day, minute)` the
 * reader's calendar handing back unix seconds: on the five-minute grid,
 * kept inside what the archive covers. Null where there is no archive.
 */
export function momentOn(
  day: number,
  minute: number,
  coverage: ArchiveCoverage | null,
  clock: (day: number, minute: number) => number,
): number | null {
  if (!coverage) return null;
  const at = onGrid(clock(day, Math.max(0, Math.min(1435, Math.round(minute / 5) * 5))));
  return Math.min(Math.max(at, coverage.since), onGrid(coverage.until));
}

/** The address that loads the page again on `weather`, straight back on to the plan, at `at` where given. */
export function boardingUrl(href: string, weather: "demo" | "live" | null, at: number | null): string {
  const url = new URL(href);
  if (weather) url.searchParams.set(WEATHER_KEY, weather);
  else url.searchParams.delete(WEATHER_KEY);
  url.searchParams.set(BOARD_KEY, at === null ? "1" : writeMoment(at));
  return url.href;
}

/** Whether an address asks to go straight on to the plan, and in which past moment; null where it does not ask. */
export function readBoarding(search: string): { at: number | null } | null {
  const asked = new URLSearchParams(search).get(BOARD_KEY);
  if (asked === null) return null;
  return { at: readMoment(asked.trim()) };
}

/** The page loaded again on `weather`, through black, and on to the plan. */
async function reloadOnto(weather: "demo" | "live", at: number | null): Promise<void> {
  if (curtainDown()) return;
  await lower();
  window.location.assign(boardingUrl(window.location.href, weather, at));
}

/**
 * The past window a flight at `at` is flown in opened: two hours ending on
 * it, as the archive keeps it. Whether it opened.
 */
export async function openPastAt(at: number): Promise<boolean> {
  const coverage = await loadCoverage();
  const past = coverage ? windowAround(at, coverage) : null;
  if (!past) return false;
  archiveWindow.set(past);
  return true;
}

/** The page's flight flown at `next`: the window opened or closed, or the page loaded again onto or off the recorded storm. */
export async function flyWhen(next: FlightWhen): Promise<void> {
  if (next.kind === "storm") {
    if (!demoWeather) await reloadOnto("demo", null);
    return;
  }
  if (demoWeather) {
    await reloadOnto("live", next.kind === "past" ? next.at : null);
    return;
  }
  if (next.kind === "now") {
    if (get(archiveWindow)) archiveWindow.set(null);
    return;
  }
  await openPastAt(next.at);
}
