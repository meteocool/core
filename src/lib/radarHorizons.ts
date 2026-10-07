/**
 * How far each radar really sees, terrain included: for every degree of
 * azimuth, the farthest range at which one of its tilts still sees down to
 * 3 km, the bottom of the layer a volume's coverage is measured over.
 *
 * Far smaller than the radar's range, and lopsided where it stands by
 * mountains: the low tilts run into the Alps, the Pyrenees or the Massif
 * Central and only the steeper ones, already high, get over. Computed offline
 * in ng from each site's own tilts and a terrain model (`src/horizons.py` in
 * worker-analysis, which says how to regenerate `radarHorizons.json`), and
 * loaded only when something draws it.
 */

export interface Horizons {
  /** The height the ranges are to, in kilometres above sea level. */
  heightKm: number;
  /** Kilometres per whole degree of azimuth, clockwise from north, for a node code. */
  of(code: string): readonly number[] | null;
}

/** Degrees either side a range is smoothed over, for a sketch rather than a fan of spikes. */
const SMOOTH_DEG = 2;

/**
 * Each range the median of its neighbourhood, round the circle. A median and
 * not a mean: a single ray slipping through a gap or caught on a peak goes,
 * a mountain's whole sector stays as sharp as it was.
 */
export function smoothed(ranges: readonly number[], half = SMOOTH_DEG): number[] {
  const n = ranges.length;
  return ranges.map((_, i) => {
    const window: number[] = [];
    for (let j = -half; j <= half; j++) window.push(ranges[(i + j + n) % n]);
    window.sort((a, b) => a - b);
    return window[half];
  });
}

let loading: Promise<Horizons> | null = null;

export function loadHorizons(): Promise<Horizons> {
  loading ??= import("./radarHorizons.json").then(({ default: file }) => {
    const sites: Record<string, number[]> = {};
    for (const [code, ranges] of Object.entries(file.sites as Record<string, number[]>)) sites[code] = smoothed(ranges);
    return {
      heightKm: file.height_km,
      // Older volumes name DWD's radars by their bare three letters; see radarSite.
      of: (code) => sites[code.toLowerCase()] ?? sites[`de${code.toLowerCase()}`] ?? null,
    };
  });
  // A chunk that failed to load is asked for again next time.
  loading.catch(() => (loading = null));
  return loading;
}
