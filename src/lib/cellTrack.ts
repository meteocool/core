import { lastRunStart } from "./cellGeometry";
import type { CellStep, CellTrack } from "../api";

/**
 * A track cut back to the last storm in it.
 *
 * `lastRunStart` explains why a track can contain two: the identity upstream
 * is DWD's cell number, which is reused, so a stale detection occasionally
 * ends up glued to an unrelated new cell. Everything the UI reads off a track
 * is derived from its series, so the cut has to be applied to all of it at
 * once -- the drawn path, the history plot, the age in the popup -- or the
 * line stops lying while the numbers beside it carry on.
 *
 * The maxima are recomputed rather than trusted: the backend took them over
 * the glued history, so a storm can inherit the peak reflectivity of one it
 * never had anything to do with. `first_seen` likewise -- one of these in a
 * real run claimed forty minutes of age that belonged to another cell.
 *
 * The lineage flags are left as they came. A `hail_ever` inherited across a
 * bad join is a false positive and this could clear it, but the flags carry
 * minute counters and merge/split history that cannot be recomputed from the
 * series, and half-correcting them would be worse than leaving them whole and
 * saying so. That part belongs upstream, where the join is made.
 */
export function trimToLastRun(track: CellTrack): CellTrack {
  const p = track.properties;
  const series = p.series ?? [];
  const from = lastRunStart(series);
  if (from === 0) return track;

  const kept = series.slice(from);
  const max = (pick: (step: CellStep) => number | null | undefined): number | null => {
    const values = kept.map(pick).filter((v): v is number => v !== null && v !== undefined);
    return values.length ? Math.max(...values) : null;
  };

  const geometry = track.geometry.type === "LineString"
    // The coordinates run one per step, so the same cut applies to both.
    ? { ...track.geometry, coordinates: (track.geometry.coordinates as number[][]).slice(from) }
    : track.geometry;

  return {
    ...track,
    geometry,
    properties: {
      ...p,
      series: kept,
      n_steps: kept.length,
      first_seen: kept[0].t,
      max_dbz: max((step) => step.max_dbz),
      echo_top_max_m: max((step) => step.echo_top_m),
      vil_max: max((step) => step.vil),
    },
  } as CellTrack;
}

