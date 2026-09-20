/**
 * How often the backend publishes, learned from when it last did.
 *
 * The radar composite is nominally on a five-minute cycle, but the number that
 * matters to someone staring at a map is not the nominal one: it is when the
 * next frame will actually land, which slips with the pipeline's own lag and is
 * different on staging. So nothing here assumes five minutes. The rhythm is
 * measured from the publish times the grid already carries, and the prediction
 * is the last one plus that rhythm.
 *
 * Pure, with no store and no clock of its own -- same arrangement as
 * apiHealth.ts and networkQuality.ts. The wiring lives in RadarCapability,
 * which is where the grid is.
 */

/** The learned rhythm, and what it implies about the next publish. */
export interface Cadence {
  /** Median gap between consecutive publishes, in seconds. */
  periodS: number | null;
  /** How many gaps that median was taken over. */
  samples: number;
  /** The most recent publish, in epoch seconds. */
  lastAt: number | null;
  /** When the next one is due, in epoch seconds. */
  nextAt: number | null;
}

export const EMPTY_CADENCE: Cadence = {
  periodS: null, samples: 0, lastAt: null, nextAt: null,
};

/**
 * A gap longer than this is a hole in the record rather than the rhythm --
 * a tab that was asleep, a backend that was restarted, a grid stitched across
 * an outage. Included in the median it would drag the prediction minutes out.
 */
export const MAX_GAP_S = 30 * 60;

/** Below this there is no pattern, only a coincidence worth not reporting. */
export const MIN_INTERVALS = 3;

function median(sorted: readonly number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The rhythm behind a set of publish times, in epoch seconds.
 *
 * Unsorted input is fine, and duplicates are ignored: every forecast frame in
 * a grid is rebuilt on the same pass and carries the same processed_time, so
 * feeding them in would otherwise report a cadence of zero.
 */
export function publishCadence(publishedAt: readonly number[]): Cadence {
  const times = [...new Set(publishedAt.filter((t) => Number.isFinite(t) && t > 0))]
    .sort((a, b) => a - b);
  const lastAt = times.length ? times[times.length - 1] : null;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap <= MAX_GAP_S) gaps.push(gap);
  }
  if (gaps.length < MIN_INTERVALS) {
    return { periodS: null, samples: gaps.length, lastAt, nextAt: null };
  }
  gaps.sort((a, b) => a - b);
  const periodS = median(gaps);
  return {
    periodS,
    samples: gaps.length,
    lastAt,
    nextAt: periodS != null && lastAt != null ? lastAt + periodS : null,
  };
}

/**
 * How late the next publish is, in seconds. Negative while it is still due,
 * null when there is no pattern to be late against.
 *
 * `now` is in epoch seconds, like the grid's own timestamps.
 */
export function overdueBy(cadence: Cadence, now: number): number | null {
  if (cadence.nextAt === null) return null;
  return Math.round(now - cadence.nextAt);
}
