/**
 * The contrails the other aircraft leave: where each has been, kept as a
 * row of points in the sky (sky.ts), so a contrail stays where it was made
 * as its aircraft goes on, spreads and fades as it ages, and is drawn as
 * one ribbon of segments with every other aircraft's (layers/trafficPass.ts).
 *
 * Whether an aircraft leaves one is worked out here, not sent: from its
 * height, with the cockpit's own atmosphere (atmosphere.ts) as warm or as
 * cold as the cockpit finds it, and the rule the cockpit's own contrail
 * follows: the air cold enough to freeze the exhaust at once, from -38 C,
 * fully by -44 C.
 */
import { temperatureK } from "../atmosphere";
import type { Sky } from "./sky";

/** How many points each keeps, how often one is laid (s) or how far apart (m), and how long a contrail lasts, s. */
export const TRAIL_POINTS = 28;
const LAY_S = 1.6;
const LAY_M = 450;
export const TRAIL_S = 42;
/** Floats per segment, as the GPU is handed them: both ends (three each), their ages (s), how strong (0 to 1), and spare. */
export const SEGMENT_FLOATS = 9;

/** How much contrail an aircraft at `altitude` leaves, 0 to 1, with the air `warmer` degrees warmer than standard. */
export function contrailStrength(altitude: number, warmer = 0): number {
  const celsius = temperatureK(altitude) - 273.15 + warmer;
  return Math.min(1, Math.max(0, (-38 - celsius) / 6));
}

/**
 * How much warmer than standard the cockpit finds the air, degrees: what
 * its outside temperature reads against the standard atmosphere's at its
 * height, held to a sensible spread.
 */
export function warmerThanStandard(temperatureC: number, altitude: number): number {
  const off = temperatureC - (temperatureK(altitude) - 273.15);
  return Number.isFinite(off) ? Math.min(Math.max(off, -20), 20) : 0;
}

export class Trail {
  /** The points' places on the map (lon, lat, true altitude), when each was laid (s), and how strong the contrail was there. */
  private readonly lon = new Float64Array(TRAIL_POINTS);
  private readonly lat = new Float64Array(TRAIL_POINTS);
  private readonly altitude = new Float64Array(TRAIL_POINTS);
  private readonly at = new Float64Array(TRAIL_POINTS);
  private readonly strength = new Float32Array(TRAIL_POINTS);
  /** Each in the sky's metres, measured from the anchor of `version`. */
  private readonly east = new Float64Array(TRAIL_POINTS);
  private readonly north = new Float64Array(TRAIL_POINTS);
  private readonly up = new Float64Array(TRAIL_POINTS);
  private version = -1;
  /** The ring: the oldest at `first`, `count` of them. */
  private first = 0;
  count = 0;

  /** Where its aircraft is now, at `now` (s), leaving a contrail this strong: a point laid, where it is time for one. */
  follow(lon: number, lat: number, altitude: number, strength: number, now: number, sky: Sky): void {
    // The oldest go once they have faded.
    while (this.count && now - this.at[this.first] > TRAIL_S) {
      this.first = (this.first + 1) % TRAIL_POINTS;
      this.count -= 1;
    }
    if (strength <= 0.01) {
      // None now: what was laid stays and fades; the next starts afresh.
      if (this.count && this.strength[this.newest()] > 0) this.lay(lon, lat, altitude, 0, now, sky);
      return;
    }
    if (this.count) {
      const last = this.newest();
      this.measure(sky);
      const far = Math.hypot(sky.east(lon) - this.east[last], sky.north(lat) - this.north[last]);
      // A jump (a new flight, an aircraft heard again far off) starts a new contrail.
      if (far > LAY_M * 8) this.count = 0;
      else if (now - this.at[last] < LAY_S && far < LAY_M) return;
    }
    this.lay(lon, lat, altitude, strength, now, sky);
  }

  private newest(): number {
    return (this.first + this.count - 1) % TRAIL_POINTS;
  }

  private lay(lon: number, lat: number, altitude: number, strength: number, now: number, sky: Sky): void {
    const slot = this.count < TRAIL_POINTS ? (this.first + this.count) % TRAIL_POINTS : this.first;
    if (this.count < TRAIL_POINTS) this.count += 1;
    else this.first = (this.first + 1) % TRAIL_POINTS;
    this.lon[slot] = lon;
    this.lat[slot] = lat;
    this.altitude[slot] = altitude;
    this.at[slot] = now;
    this.strength[slot] = strength;
    if (this.version === sky.version) {
      this.east[slot] = sky.east(lon);
      this.north[slot] = sky.north(lat);
      this.up[slot] = sky.up(altitude);
    }
  }

  /** Every point measured from the sky's anchor as it is now. */
  private measure(sky: Sky): void {
    if (this.version === sky.version) return;
    this.version = sky.version;
    for (let k = 0; k < this.count; k += 1) {
      const i = (this.first + k) % TRAIL_POINTS;
      this.east[i] = sky.east(this.lon[i]);
      this.north[i] = sky.north(this.lat[i]);
      this.up[i] = sky.up(this.altitude[i]);
    }
  }

  /**
   * Its segments, oldest first, into `out` from segment `offset`, at most
   * `most` of them: each end north, east and down of `origin` (the sky's
   * metres of the eye's aircraft), its age at `now` and its strength. The
   * last runs from the newest point to `head` (where the aircraft is now,
   * in the same frame), so the contrail stays on its aircraft. How many
   * were written.
   */
  write(
    out: Float32Array, offset: number, most: number, sky: Sky, origin: readonly [number, number, number],
    head: readonly [number, number, number] | null, headStrength: number, now: number,
  ): number {
    if (most <= 0 || !this.count) return 0;
    this.measure(sky);
    const [oe, on, ou] = origin;
    let written = 0;
    // The newest ones first if not all fit: they are where the aircraft is.
    const segments = this.count - 1 + (head ? 1 : 0);
    const skip = Math.max(0, segments - most);
    for (let k = skip; k < this.count - 1 && written < most; k += 1) {
      const a = (this.first + k) % TRAIL_POINTS;
      const b = (this.first + k + 1) % TRAIL_POINTS;
      const strength = Math.min(this.strength[a], this.strength[b] || this.strength[a]);
      if (this.strength[a] <= 0.01) continue;
      put(out, offset + written, this.north[a] - on, this.east[a] - oe, ou - this.up[a], this.north[b] - on, this.east[b] - oe, ou - this.up[b],
        now - this.at[a], now - this.at[b], strength);
      written += 1;
    }
    if (head && written < most && headStrength > 0.01) {
      const a = this.newest();
      if (this.strength[a] > 0.01) {
        put(out, offset + written, this.north[a] - on, this.east[a] - oe, ou - this.up[a], head[0], head[1], head[2],
          now - this.at[a], 0, Math.min(headStrength, this.strength[a]));
        written += 1;
      }
    }
    return written;
  }
}

function put(
  out: Float32Array, segment: number, an: number, ae: number, ad: number, bn: number, be: number, bd: number, ageA: number, ageB: number, strength: number,
): void {
  const at = segment * SEGMENT_FLOATS;
  out[at] = an;
  out[at + 1] = ae;
  out[at + 2] = ad;
  out[at + 3] = bn;
  out[at + 4] = be;
  out[at + 5] = bd;
  out[at + 6] = ageA;
  out[at + 7] = ageB;
  out[at + 8] = strength;
}
