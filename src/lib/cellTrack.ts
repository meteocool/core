import { ACTIVE_MINUTES } from "./cellGeometry";
import type { CellStep, CellTrack, CellTrackProperties } from "../api";

/** The largest of one field over some steps, or null when none of them has it. */
function maxOver(steps: CellStep[], pick: (step: CellStep) => number | null | undefined): number | null {
  const values = steps.map(pick).filter((v): v is number => v !== null && v !== undefined);
  return values.length ? Math.max(...values) : null;
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
 * A track whose last detection is at or before the moment is otherwise as it
 * is now, but for whether it was still active then, which is the backend's
 * own rule applied at the moment (see `ACTIVE_MINUTES`).
 */
export function trackAsOf(track: CellTrack, atMs: number): CellTrack | null {
  const p = track.properties;
  const series = p.series ?? [];
  const count = series.findIndex((step) => new Date(step.t).getTime() > atMs);
  if (count === -1) {
    if (new Date(p.first_seen).getTime() > atMs) return null;
    const active = atMs - new Date(p.last_seen).getTime() <= ACTIVE_MINUTES * 60_000;
    return active === p.active ? track : { ...track, properties: { ...p, active } } as CellTrack;
  }
  if (count === 0) return null;

  const kept = series.slice(0, count);
  const coordinates = track.geometry.type === "LineString"
    ? (track.geometry.coordinates as number[][])
    : null;
  // The coordinates run one per step, so the same cut applies to both.
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

/**
 * A cell's copy with the radar volume already known for it, if it came without one.
 *
 * The viewport answer (`/cells/tracks?bbox=…`) never carries a volume: only
 * `/cells/tracks/{code}` and `/cells/current` do. So a copy without one says
 * nothing about the storm, and taking it as it came would drop the volume a
 * link or a tap fetched, and the "Inside" cutaway with it, from an open panel
 * at the first refresh. A copy that has a volume is the newer word and wins.
 *
 * `known` are the other copies held of the storm, in order of preference;
 * one for a different code is no evidence about this one and is passed over.
 */
export function withKnownVolume(
  next: CellTrackProperties,
  ...known: (CellTrackProperties | null | undefined)[]
): CellTrackProperties {
  if (next.volume) return next;
  const volume = known.find((copy) => copy?.code === next.code && copy.volume)?.volume;
  return volume ? { ...next, volume } : next;
}
