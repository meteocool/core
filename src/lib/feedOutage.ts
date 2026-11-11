/**
 * Which weather services' radar is not reaching meteocool right now.
 *
 * Each country's radar comes from its own weather service, through EUMETNET,
 * and one of them (or the whole of EUMETNET's feed) can stop while DWD's
 * keeps going. The map then has nothing new to draw for that country, and
 * meteocool's nowcast, which runs on the same radar, has no run for it: the
 * player would say "No Forecast Here" over ground it normally forecasts. The
 * reader is owed the real reason instead.
 *
 * Measured against DWD's newest scan rather than the clock, as
 * lib/observedProduct.ts's `fallsBehind` is: when everything is late together
 * (a sleeping tab, or meteocool's own backend stalled), no one country's
 * service is to blame, and the map's own "Out of date" and "Degraded" say so.
 *
 * Pure, with no store and no clock: RadarCapability samples the frames and
 * publishes the verdict in the `stalledNetworks` store.
 */
import type { CountryNetwork } from "../api/events";

/**
 * How far a network's newest scan may trail DWD's before its feed counts as
 * stopped: three of its five-minute cycles, the same three cycles the
 * backend's composites keep a quiet radar for before leaving it out.
 */
export const STALLED_BEHIND_S = 15 * 60;

/** What a network's live layer knows: its newest fresh scan, if any, and whether the backend has answered for it at all. */
export interface NetworkFeed {
  code: CountryNetwork;
  /** Its newest fresh frame's scan, unix seconds; null when it has none (none yet, or one too old to draw). */
  newestScan: number | null;
  /** Whether the backend has answered for it, with a frame or with none; before that, nothing is known. */
  answered: boolean;
}

/**
 * The networks whose feed has stopped: answered, and with no fresh frame or
 * one whose scan trails DWD's newest (`reference`) by more than
 * `STALLED_BEHIND_S`. None while DWD's own scan is unknown: there is nothing
 * to measure against, and nothing loaded is not an outage.
 */
export function stalledNetworks(feeds: readonly NetworkFeed[], reference: number | null): CountryNetwork[] {
  if (reference === null) return [];
  return feeds
    .filter((feed) => feed.answered && (feed.newestScan === null || reference - feed.newestScan > STALLED_BEHIND_S))
    .map((feed) => feed.code);
}

/**
 * Whether the player says the data is not arriving, given the share of the
 * screen that stalled networks draw on and whether it would otherwise say
 * there is no forecast.
 *
 * In place of "No Forecast Here" wherever a stalled network is on screen at
 * all: the forecast is missing there because its radar is. On any other step
 * only when they hold at least half the screen, so a border strip of a
 * silent neighbour does not put a notice over a map that is otherwise live.
 */
export function saysFeedStopped(stalledShare: number, noForecast: boolean): boolean {
  if (stalledShare <= 0) return false;
  return noForecast || stalledShare >= 0.5;
}
