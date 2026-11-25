/**
 * The strongest storm of the history: a past moment of the radar's own
 * weather to fly at, where the live sky has none, or where the reader asks
 * for it in the plan (when.ts, "Recorded storm").
 *
 * The backend keeps a continuous history (`/v3/archive`), so the storm is
 * just a past window on the page's own weather: nothing is loaded again to
 * go onto it or off it.
 *
 * Found from the storms the history lists over all it keeps, the severe
 * ones only: those that lived long enough to be weather rather than
 * clutter, ranked by how much they mattered and how long they lasted. The
 * best few are looked at in their middle, and the first one with a
 * thunderstorm there, a heavy core with lightning (fallback.ts), is it;
 * where none has, the best of them with 3D clouds there all the same. One
 * without any is never it: the radar's history can reach further back than
 * its 3D clouds do.
 */
import { writable } from "svelte/store";
import { fetchStorms, quietly } from "../../../api";
import type { Storm } from "../../../api";
import { loadCoverage } from "../../archiveCoverage";
import { onGrid, STEP_S } from "../../archive";
import type { ArchiveCoverage } from "../../archive";
import { distanceM } from "./geo";
import { systemsAt, worthy, WORTHY_DBZ } from "./fallback";

/** The storm, at its moment: unix seconds on the five-minute grid, and where it stood then, degrees. */
export interface HistoryStorm {
  at: number;
  lon: number;
  lat: number;
}

/** Everywhere the radar sees, west, south, east, north, degrees. */
const EUROPE: [number, number, number, number] = [-30, 25, 50, 75];
/** The severity the storms are listed from: severe, as the storm list grades them. */
const MIN_SEVERITY = 2;
/** A storm shorter-lived than this is most often clutter, however strong it looked, minutes. */
const MIN_LIFE_MIN = 30;
/** A storm lasting this long or more counts in full; a shorter one for as much of it as it lasted, minutes. */
const FULL_LIFE_MIN = 90;
/** How many of the best are looked at for lightning. */
const LOOKED_AT = 6;
/** A system whose edge is this near where the storm stood holds the storm, km. */
const SAME_STORM_KM = 30;

const seconds = (iso: string) => Date.parse(iso) / 1000;

/** Where a storm stood at `at`: on its path, as far along as `at` is through its life; else where it was last. */
function whereAt(storm: Storm, fraction: number): [number, number] {
  const path = storm.properties.path;
  if (path.type === "LineString" && path.coordinates.length) {
    const point = path.coordinates[Math.min(path.coordinates.length - 1, Math.round(fraction * (path.coordinates.length - 1)))];
    return [point[0], point[1]];
  }
  const [lon, lat] = storm.geometry.coordinates;
  return [lon, lat];
}

/**
 * The storms worth looking at, best first, each at the middle of its life
 * where the history still keeps it.
 */
export function historyCandidates(storms: readonly Storm[], coverage: ArchiveCoverage): HistoryStorm[] {
  return storms
    .flatMap((storm) => {
      const born = seconds(storm.properties.born_at);
      const last = seconds(storm.properties.last_seen);
      const lifeMin = (last - born) / 60;
      if (!Number.isFinite(lifeMin) || lifeMin < MIN_LIFE_MIN) return [];
      if ((storm.properties.peak_dbz ?? 0) < WORTHY_DBZ) return [];
      const at = onGrid((born + last) / 2);
      // The flight's window ends on its moment: one step in at least, and not past what the history keeps.
      if (at < coverage.since + STEP_S || at > coverage.until) return [];
      const [lon, lat] = whereAt(storm, 0.5);
      const score = (storm.properties.rating ?? 0) * Math.min(1, lifeMin / FULL_LIFE_MIN);
      return [{ at, lon, lat, score }];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ at, lon, lat }) => ({ at, lon, lat }));
}

async function find(): Promise<HistoryStorm | null> {
  const coverage = await loadCoverage();
  if (!coverage) return null;
  let storms: Storm[];
  try {
    const answer = await fetchStorms(EUROPE, { since: coverage.since, until: coverage.until }, quietly, { minSeverity: MIN_SEVERITY });
    storms = answer.features ?? [];
  } catch {
    return null;
  }
  let clouded: HistoryStorm | null = null;
  for (const candidate of historyCandidates(storms, coverage).slice(0, LOOKED_AT)) {
    const near = (await systemsAt(candidate.at))?.filter((system) => (
      distanceM(candidate.lon, candidate.lat, system.lon, system.lat) / 1000 <= system.radiusKm + SAME_STORM_KM
    )) ?? [];
    if (near.some(worthy)) return candidate;
    // A moment with no 3D clouds there is no flight, whatever the radar kept of it.
    if (near.length) clouded ??= candidate;
  }
  return clouded;
}

/**
 * Whether this build offers the history's storm: one with a backend of its
 * own, not a dev server's proxy, nor the demo's site, whose weather is its
 * recording.
 */
export const historyStormBuild = !import.meta.env?.DEV && import.meta.env?.MODE !== "demo";

/** The storm, once found; null until then, and where the history has none. */
export const historyStorm = writable<HistoryStorm | null>(null);

let asked: Promise<HistoryStorm | null> | null = null;

/** Find the strongest storm of the history, once a page: it is looked for from the same few lists each time. */
export function findHistoryStorm(): Promise<HistoryStorm | null> {
  asked ??= find().then((found) => {
    historyStorm.set(found);
    // None found may be the backend's moment: asked again next time.
    if (!found) asked = null;
    return found;
  });
  return asked;
}
