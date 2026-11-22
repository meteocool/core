/**
 * Whose weather the page shows: its own backend's (src/urls.ts), or the
 * demo's recorded storm.
 *
 * Only the flight's page asks for the demo's, and only with `?weather=demo`,
 * which it adds itself when the live radar has no storm worth flying at
 * (lib/studio/flight/fallback.ts): then a flight from meteocool.com or
 * next.meteocool.com flies demo.meteocool.com's storm, on the page it was
 * opened on. Settled once, before anything reads an address, as the
 * backends are: the page loads again to change it.
 *
 * `?weather=live` is the reader's own "the live weather, whatever it is",
 * which the page never overrides.
 *
 * A link shared in flight says whose weather it was flown in, in its
 * snapshot (lib/studio/snapshot.ts, `weather`), and is flown in the same
 * again where the address does not say otherwise: a moment over the demo's
 * storm is over that storm, whoever opens it and wherever.
 */
import { readSnapshot, SNAPSHOT_KEY } from "./lib/studio/snapshot";

export const WEATHER_KEY = "weather";
export type WeatherChoice = "demo" | "live" | null;

/** Whether a location is the flight's page: meteoair.html, or a page at `#meteoair` (lib/studio/flightPage.ts). */
export function isFlightPage(location: Pick<Location, "pathname" | "hash">): boolean {
  return /\/meteoair(\.html)?$/i.test(location.pathname) || location.hash.toLowerCase() === "#meteoair";
}

/** What a location asks of the weather, on the flight's page; null anywhere else, or where it asks nothing. */
export function weatherChoice(location: Pick<Location, "pathname" | "hash" | "search">): WeatherChoice {
  if (!isFlightPage(location)) return null;
  const query = new URLSearchParams(location.search);
  const asked = (query.get(WEATHER_KEY) ?? readSnapshot(query.get(SNAPSHOT_KEY))?.weather);
  const choice = typeof asked === "string" ? asked.toLowerCase() : null;
  return choice === "demo" || choice === "live" ? choice : null;
}

/** Whether this build has a demo to fall back on: one with live weather of its own, not the demo itself nor a dev server's proxy. */
export const demoFallbackBuild = !import.meta.env?.DEV && import.meta.env?.MODE !== "demo";

/** Whether this page shows the demo's weather in place of its own backend's. */
export const demoWeather = demoFallbackBuild && typeof window !== "undefined" && weatherChoice(window.location) === "demo";

/** Whether the weather on this page is the demo's recorded storm: on demo.meteocool.com, or in place of a live radar's. */
export const demoBackend = import.meta.env?.MODE === "demo" || demoWeather;
