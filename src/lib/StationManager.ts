import { derived, get } from "svelte/store";
import { fetchStationObservations, NothingPublished } from "../api";
import type { ObservedFeature, Progress } from "../api";
import {
  capLatestObservation, capTimeIndicator, live, radarColorScheme, selectedStation, sharedActiveCap, stationChoice,
  stationLayerVisible, stationView, zoomlevel,
} from "../stores";
import type { StationLayer } from "../layers/stations";
import {
  parametersFor, resolutionAt, STATIONS_MAX_AGE_MINUTES, STATIONS_REFRESH_MS, STATIONS_SCRUB_DEBOUNCE_MS, stationsAt, stationsShown, stationsStale,
  thinningCell,
} from "./stations";
import type { StationChoice } from "./stations";
import { whenVisible } from "./wakeup";

/**
 * The weather stations over the radar map, end to end: what to ask for, when,
 * and what the tray and the sheet read of it.
 *
 * Everything it decides is in `stations.ts`, pure; this is the plumbing
 * between the toggle (`stationLayerVisible`), the tray's choice
 * (`stationChoice`), the timeline and the layer. It asks only while the
 * stations are shown (`stationsShown`): when they come on, every five minutes
 * while the page is visible, on a wake, and when the choice or the
 * timeline's frame changes. An empty answer, or a backend without stations,
 * is an empty overlay and nothing more.
 */
export default class StationManager {
  private choice: StationChoice = get(stationChoice);

  /** The time to ask about; null for the newest. */
  private at: Date | null = null;

  /** The choice the stations on the map were asked for, null before any were. */
  private drawnChoice: StationChoice | null = null;

  private shown = false;

  /** Bumped by every fetch, so an answer that lands after a newer question is dropped. */
  private generation = 0;

  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  private scrubTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly layer: StationLayer, private readonly bar: Progress) {
    this.unsubscribers.push(radarColorScheme.subscribe((palette) => layer.setPalette(palette)));
    this.unsubscribers.push(derived([stationLayerVisible, sharedActiveCap], ([on, cap]) => stationsShown(on, cap))
      .subscribe((shown) => this.showChanged(shown)));
    this.unsubscribers.push(stationChoice.subscribe((choice) => {
      if (choice === this.choice) return;
      this.choice = choice;
      // The sheet's values are the last choice's.
      selectedStation.set(null);
      if (this.shown) void this.fetch();
    }));
    // The timeline's frame, once it comes to rest: a scrub passes through
    // dozens, and only the one it stops on is worth asking about. Following
    // live is the newest whatever the two say: a new grid moves the newest
    // observation a moment before the player moves onto it, and in between
    // the frame on screen reads as the past.
    this.unsubscribers.push(derived(
      [capTimeIndicator, capLatestObservation, live],
      ([shown, newest, following]) => (following ? null : stationsAt(shown, newest)),
    )
      .subscribe((at) => {
        clearTimeout(this.scrubTimer);
        this.scrubTimer = setTimeout(() => {
          if (at?.getTime() === this.at?.getTime()) return;
          this.at = at;
          if (this.shown) void this.fetch();
        }, STATIONS_SCRUB_DEBOUNCE_MS);
      }));
    // Greyed on a forecast frame at once, not once the scrub rests: the
    // first forecast frame scrubbed past is already not what they measured.
    this.unsubscribers.push(derived(
      [capTimeIndicator, capLatestObservation, live],
      ([shown, newest, following]) => !following && stationsStale(shown, newest),
    )
      .subscribe((stale) => layer.setStale(stale)));
    // Thinned for the zoom the map came to rest at.
    this.unsubscribers.push(zoomlevel.subscribe((zoom) => layer.thin(thinningCell(zoom), resolutionAt(zoom))));
  }

  /** Coming back to the page: the newest stations, if they are shown. */
  resync() {
    if (this.shown) void this.fetch();
  }

  private showChanged(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.layer.layer.setVisible(shown);
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    if (!shown) {
      selectedStation.set(null);
      return;
    }
    this.refreshTimer = setInterval(() => whenVisible("stations", () => { if (this.shown) void this.fetch(); }), STATIONS_REFRESH_MS);
    void this.fetch();
  }

  private async fetch() {
    const generation = ++this.generation;
    const { choice, at } = this;
    let stations: ObservedFeature[] | null;
    try {
      stations = (await fetchStationObservations(parametersFor(choice), at, STATIONS_MAX_AGE_MINUTES, this.bar)).features;
    } catch (error) {
      // No stations served here (demo, or a backend without them yet) is an
      // empty overlay. Anything else keeps what is drawn, unless it was drawn
      // for another choice and would now read as this one.
      stations = error instanceof NothingPublished || this.drawnChoice !== choice ? [] : null;
    }
    if (generation !== this.generation || stations === null) return;
    this.layer.show(stations, choice);
    this.drawnChoice = choice;
    const newest = stations.reduce<number>((latest, station) => Math.max(latest, Date.parse(station.properties.observed_at)), 0);
    stationView.set({ count: stations.length, observedAt: newest > 0 ? new Date(newest) : null });
  }

  destroy() {
    clearInterval(this.refreshTimer);
    clearTimeout(this.scrubTimer);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
}
