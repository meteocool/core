import { lastRunStart } from "./cellGeometry";
import type { CellStep, CellTrack } from "../api";

/** The largest of one field over some steps, or null when none of them has it. */
function maxOver(steps: CellStep[], pick: (step: CellStep) => number | null | undefined): number | null {
  const values = steps.map(pick).filter((v): v is number => v !== null && v !== undefined);
  return values.length ? Math.max(...values) : null;
}

/**
 * A track cut back to the last storm in it.
 *
 * `lastRunStart` explains why a track can contain two: the identity upstream
 * is DWD's cell number, which is reused, so a stale detection occasionally
 * ends up glued to an unrelated new cell. Everything the UI reads off a track
 * is derived from its series, so the cut has to be applied to all of it at
 * once (the drawn path, the history plot, the age in the popup), or the line
 * stops lying while the numbers beside it carry on.
 *
 * The maxima are recomputed rather than trusted: the backend took them over
 * the glued history, so a storm can inherit the peak reflectivity of one it
 * never had anything to do with. `first_seen` too: one of these in a real
 * run claimed forty minutes of age that belonged to another cell.
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
  const max = (pick: (step: CellStep) => number | null | undefined) => maxOver(kept, pick);

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


/**
 * A track as it stood at `atMs`, or null for a storm not yet detected then.
 *
 * What the map draws when the player is parked on an earlier frame. The
 * tracks answer covers three hours back and every track carries its whole
 * series, so the past is in hand already and costs no request: a track is cut
 * after the last detection at or before the moment, and becomes what it was
 * then, still active, with no children yet and nothing that only its newest
 * detection had (the outline, the forecast, the 3D volume).
 *
 * A track whose last detection is at or before the moment is returned as it
 * is: by then it was what it still is.
 */
export function trackAsOf(track: CellTrack, atMs: number): CellTrack | null {
  const p = track.properties;
  const series = p.series ?? [];
  const count = series.findIndex((step) => new Date(step.t).getTime() > atMs);
  if (count === -1) return new Date(p.first_seen).getTime() <= atMs ? track : null;
  if (count === 0) return null;

  const kept = series.slice(0, count);
  const coordinates = track.geometry.type === "LineString"
    ? (track.geometry.coordinates as number[][])
    : null;
  // The coordinates run one per step, as `trimToLastRun` relies on too.
  const geometry = coordinates && coordinates.length === series.length
    ? { ...track.geometry, coordinates: coordinates.slice(0, count) }
    : track.geometry;
  return {
    ...track,
    geometry,
    properties: {
      ...p,
      series: kept,
      n_steps: kept.length,
      last_seen: kept[kept.length - 1].t,
      active: true,
      child_codes: [],
      forecast: [],
      polygon: null,
      volume: null,
      structure: [],
      placement: null,
      max_severity: maxOver(kept, (step) => step.severity) ?? p.max_severity,
      max_dbz: maxOver(kept, (step) => step.max_dbz),
      echo_top_max_m: maxOver(kept, (step) => step.echo_top_m),
      vil_max: maxOver(kept, (step) => step.vil),
    },
  } as CellTrack;
}
