/**
 * The track the board is sent: a sample of where the aircraft is every
 * second of the flight's clock, gathered and sent in batches on a timer,
 * with the feats the cockpit earned in between.
 *
 * The flight's clock is the seconds of flight the cockpit has flown since
 * the board's flight started: what the score counts, so it runs faster
 * under warp and stops while the flight is paused or out of sight.
 */
import type { Feat } from "../score";
import type { FeatClaim, FlightLimits, Sample, TrackBody } from "./wire";

/** A sample every second of the flight's clock. */
export const SAMPLE_EVERY_S = 1;
/** A batch every ten seconds of real time, at most; never sooner than the board's own interval. */
export const SEND_EVERY_MS = 10_000;

/** What has gathered and is not yet on the board. */
export interface Gathered {
  samples: Sample[];
  feats: FeatClaim[];
}

export const NOTHING: Gathered = { samples: [], feats: [] };

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** A sample, to as many places as the board can use: a hundredth of a second, about a metre across, a decimetre up. */
export function sampleAt(t: number, lon: number, lat: number, altitude: number): Sample {
  return [round(t, 2), round(lon, 5), round(lat, 5), round(altitude, 1)];
}

/**
 * Whether a sample is due at `t`, the next being due at `next`: on a grid
 * of whole seconds, so frames of flight longer than a tenth of a second
 * (under warp) still give a sample a second on the whole.
 */
export function sampleDue(next: number, t: number): boolean {
  return t >= 0 && t >= next - 1e-6;
}

/** When the sample after one taken at `t` is due, the one taken having been due at `next`: a second on, or the next whole second after a jump. */
export function nextSampleAt(next: number, t: number): number {
  const after = next + SAMPLE_EVERY_S;
  return after > t ? after : Math.floor(t / SAMPLE_EVERY_S) * SAMPLE_EVERY_S + SAMPLE_EVERY_S;
}

/**
 * The feats earned since `seen`, claimed at `t`. Not the landing's: the
 * board grants those with the flight's end, never in a batch.
 */
export function newClaims(seen: readonly Feat[], now: readonly Feat[], t: number): FeatClaim[] {
  return now
    .filter((feat) => !seen.includes(feat) && feat !== "landed" && feat !== "butter")
    .map((feat) => ({ feat, t: round(Math.max(0, t), 2) }));
}

/** What has gathered, with more added, keeping only the newest `limits.max_samples`: older ones would score nothing by the time they arrive. */
export function gather(gathered: Gathered, more: Partial<Gathered>, limits: Pick<FlightLimits, "max_samples">): Gathered {
  const samples = [...gathered.samples, ...(more.samples ?? [])];
  return {
    samples: samples.length > limits.max_samples ? samples.slice(samples.length - limits.max_samples) : samples,
    feats: [...gathered.feats, ...(more.feats ?? [])],
  };
}

/** Whether there is anything to send. */
export const anything = (gathered: Gathered): boolean => gathered.samples.length > 0 || gathered.feats.length > 0;

/**
 * The next batch out of what has gathered, the oldest first, within the
 * board's limits on samples, feats and bytes, and within `most` samples
 * where a batch had to be split; and what is left for the batch after it.
 */
export function nextBatch(
  gathered: Gathered,
  limits: Pick<FlightLimits, "max_samples" | "max_feats" | "max_bytes">,
  most = Infinity,
): { batch: Gathered; rest: Gathered } {
  let count = Math.min(gathered.samples.length, limits.max_samples, Math.max(1, most));
  const feats = gathered.feats.slice(0, limits.max_feats);
  const body = (n: number) => bodyOf({ samples: gathered.samples.slice(0, n), feats });
  while (count > 1 && new TextEncoder().encode(JSON.stringify(body(count))).length > limits.max_bytes) count = Math.floor(count / 2);
  return {
    batch: { samples: gathered.samples.slice(0, count), feats },
    rest: { samples: gathered.samples.slice(count), feats: gathered.feats.slice(feats.length) },
  };
}

/** A batch the board did not take, put back in front of what gathered meanwhile. */
export function putBack(sent: Gathered, since: Gathered, limits: Pick<FlightLimits, "max_samples">): Gathered {
  return gather(sent, since, limits);
}

/** How many samples to send next after the board said a batch of `sent` was too much: half as many. */
export function splitOf(sent: number): number {
  return Math.max(1, Math.floor(sent / 2));
}

/** The body a batch is sent as: only the fields it has. */
export function bodyOf(gathered: Gathered, landing: { sink: number } | null = null): TrackBody {
  return {
    ...(gathered.samples.length ? { samples: gathered.samples } : {}),
    ...(gathered.feats.length ? { feats: gathered.feats } : {}),
    ...(landing ? { landing: { sink: round(Math.max(0, landing.sink), 3) } } : {}),
  };
}
