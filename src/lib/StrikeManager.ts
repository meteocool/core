import Point from "ol/geom/Point";
import { Feature } from "ol";
import type StrikeSource from "../layers/strikeSource";

/** One strike: EPSG:3857 metres, and its time in ms, which is also its feature id. */
export interface Strike {
  lon: number;
  lat: number;
  time: number;
}

/**
 * How long live strikes are held so they reach the map together; see
 * lib/coalesce.ts. Short against the feed's own latency, which is seconds.
 */
export const LIVE_STRIKE_BATCH_MS = 500;

/**
 * The strike layer used by the radar capability: a ring buffer of features,
 * keyed by the strike time that is also their feature id.
 */
export default class StrikeManager {
  /** How many strikes to keep before evicting the oldest. */
  maxStrikes: number;

  /** The source the features are drawn from. */
  vs: StrikeSource;

  /** Feature ids, oldest first. */
  strikes: number[];

  enabled: boolean;

  constructor(maxStrikes: number, vectorSource: StrikeSource) {
    this.maxStrikes = maxStrikes;
    this.vs = vectorSource;
    this.strikes = [];
    this.enabled = true;
  }

  addStrike(lon: number, lat: number, addCb: ((feature: Feature) => void) | null = null) {
    return this.addStrikeWithTime(lon, lat, new Date().getTime(), addCb);
  }

  /**
   * A strike off the socket, under its own time rather than the moment it
   * arrived.
   *
   * Keyed on arrival, it never matched anything: the same strike sent again a
   * few hundred milliseconds later -- upstream repeats about one in ten --
   * was drawn twice, as was a strike the cache already held, and its age ran
   * from when it reached the page rather than from when it struck. Under its
   * own time it rounds to the id the cache gives it (App.svelte), and the
   * source refuses the copy.
   */
  addLiveStrike({ lon, lat, time }: { lon: number; lat: number; time: number }) {
    return this.addStrikeWithTime(lon, lat, Math.round(time));
  }

  /** Live strikes that arrived together, for one change on the source. */
  addLiveStrikes(strikes: { lon: number; lat: number; time: number }[]) {
    this.vs.batch(() => strikes.forEach((strike) => this.addLiveStrike(strike)));
  }

  removeOne(id: number, idx: number) {
    const remove = this.vs.getFeatureById(id);
    if (remove) {
      this.vs.removeFeature(remove);
    }
    if (idx !== -1) {
      this.strikes.splice(idx, 1);
    }
  }

  // Coordinates arrive already projected. Both the `lightning` websocket event
  // and /lightning_cache document lat/lon as "EPSG:3857 northing/easting, in
  // metres" (src/api/generated/data.ts), so they are used as they are. Passing
  // them through fromLonLat reads as the obvious fix -- it is what the
  // vibeocool branch does -- but it multiplies them by ~111319 and throws every
  // strike off the map.
  addStrikeWithTime(lon: number, lat: number, time: number, addCb: ((feature: Feature) => void) | null = null) {
    if (!this.enabled) return false;
    // A repeat -- the feed sends about one strike in ten twice -- would take
    // a slot in the ring buffer for a feature the source refuses, and evicting
    // that slot later took the one real feature with it, early.
    if (this.vs.getFeatureById(time)) return false;
    const lightning = new Feature(new Point([lon, lat]));
    lightning.setId(time);
    this.strikes.push(lightning.getId() as number);
    if (this.strikes.length > this.maxStrikes) {
      const toRemove = this.strikes.shift();
      if (toRemove !== undefined) this.removeOne(toRemove, -1);
    }
    if (addCb) {
      addCb(lightning);
    }
    return this.vs.addFeature(lightning);
  }

  /**
   * Many strikes, one by one as `addStrikeWithTime` adds them, for one change
   * on the source rather than one each; see layers/strikeSource.ts.
   */
  addStrikes(strikes: Strike[]) {
    this.vs.batch(() => {
      strikes.forEach(({ lon, lat, time }) => this.addStrikeWithTime(lon, lat, time));
    });
  }

  // purge old strikes
  fadeStrikes() {
    const now = new Date().getTime();
    const MINS = 60 * 1000;
    // One change for the lot, as in addStrikes.
    this.vs.batch(() => {
      // Backwards: removeOne splices, so a forward walk skips the element that
      // slides into the index it just vacated.
      for (let idx = this.strikes.length - 1; idx >= 0; idx -= 1) {
        const id = this.strikes[idx];
        if (id < now - 30 * MINS) {
          this.removeOne(id, idx);
        }
      }
      // Not `refresh()`: on an OpenLayers 10 vector source that is `clear()`,
      // and it emptied the whole map of strikes every five minutes rather than
      // the ones that had aged out.
      this.vs.changed();
    });
  }

  clearAll() {
    this.strikes = [];
    this.vs.clear();
  }

  debug() {
    console.log(this.strikes);
    console.log(this.vs.getFeatures());
  }

  enable(state: boolean) {
    if (!state) this.clearAll();
    this.enabled = state;
  }
}
