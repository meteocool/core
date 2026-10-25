/**
 * What the flat map draws for the storms in view, as plain marks in degrees.
 *
 * The same visual language KONRAD3D's tracks had (layers/cells.ts): each
 * storm's path, its position now, its outline, and for the selected storm
 * KONRAD3D's forecast centroids and the uncertainty ellipse around each; and a
 * dotted join where one storm merged into another, or split off one. Over Germany a storm
 * whose primary track is KONRAD3D's is DWD's, and its position is a diamond;
 * elsewhere it has meteocool's tracker's track and nothing else, a circle:
 * no forecast, no hail or rotation badge, a colour from its peak alone.
 *
 * Pure, and free of OpenLayers (StormManager projects the marks at the
 * edge), so the rules can be tested: what is drawn at all, what a merged
 * storm keeps, where a join goes, what an earlier frame shows.
 */
import type { CellTrackProperties, Storm } from "../api";
import { ACTIVE_MINUTES, ageMinutes, ellipseRing4326, leadingTip } from "./cellGeometry";
import { isLive } from "./cellPulse";
import { KONRAD3D, outlineOf, stormSource } from "./stormSelection";
import type { StormSelection, StormSource } from "./stormSelection";

/**
 * What a mark is: a storm's path, its `position` now, its outline, a forecast
 * centroid and its ellipse, or a join: into the storm it merged into, or out
 * of the storm it split from.
 */
export type StormMarkKind = "path" | "link" | "position" | "outline" | "forecast" | "ellipse";

type LonLat = [number, number];

export type MarkGeometry =
  | { type: "Point"; coordinates: LonLat }
  | { type: "LineString"; coordinates: LonLat[] }
  | { type: "Polygon"; coordinates: LonLat[][] };

export interface StormMark {
  kind: StormMarkKind;
  /** Unique among the marks: the OpenLayers feature id. */
  id: string;
  /** The storm it belongs to; a join belongs to the storm it leads into. */
  storm: string;
  /** For a join: the storm it leads out of, the one that merged or the one split from. */
  from_storm?: string;
  geometry: MarkGeometry;
  severity: number;
  /** Whose tracking it is: a DWD storm's position is a diamond, meteocool's a circle (layers/cells.ts). */
  source: StormSource;
  hail: boolean;
  meso: boolean;
  /** Minutes since the storm was last seen, which fades it. */
  age_minutes: number;
  /** Still being seen: ringed, and drawn at every zoom. */
  live: boolean;
  /** For an ellipse: the moment it is for, its lead over the last detection, and where to label it. */
  forecast_at?: number;
  lead_minutes?: number;
  tip?: LonLat;
}

export interface StormDrawing {
  /** Paths, positions, outlines and the forecast; drawn over the joins. */
  marks: StormMark[];
  /** The joins, drawn underneath. */
  links: StormMark[];
  /**
   * Where the live ring goes round a storm, and how long the storm has been
   * tracked, from its first detection to its last: with the severity, what
   * decides which rings give way zoomed out (lib/cellPulse.ts `crowdedOut`).
   */
  pings: { storm: string; severity: number; coordinates: LonLat; history_minutes: number }[];
}

const pairs = (coordinates: number[][]): LonLat[] => coordinates.map((c) => [c[0], c[1]]);

/** A storm's path as [lon, lat] pairs, oldest first; one point until it moves. */
export function pathOf(storm: Storm): LonLat[] {
  const { path } = storm.properties;
  if (path.type === "LineString") return pairs(path.coordinates);
  return [[path.coordinates[0], path.coordinates[1]]];
}

/** Where a storm is now: the feature's own geometry. */
function centroidOf(storm: Storm): LonLat {
  const [lon, lat] = storm.geometry.coordinates;
  return [lon, lat];
}

/**
 * A storm as it stood at `atMs`, or null for one not yet born then.
 *
 * What the map draws on an earlier frame, out of the answer already held. A
 * storm's path carries no times, so one still going at the moment is cut
 * back in proportion to how far through its life the moment was: its steps
 * are the primary track's, a few minutes apart, so that is close, and it is
 * a mark on a past frame, not a measurement. Cut back, it is active, merged
 * into nothing yet, and has no outline (that is its newest detection's).
 */
export function stormAsOf(storm: Storm, atMs: number): Storm | null {
  const p = storm.properties;
  const born = new Date(p.born_at).getTime();
  const seen = new Date(p.last_seen).getTime();
  if (born > atMs) return null;
  if (seen <= atMs) {
    // Ended is decided a while after the last sighting; within it, still going.
    const ended = p.status === "ended" && atMs - seen > ACTIVE_MINUTES * 60_000;
    const status = p.status === "ended" && !ended ? "active" : p.status;
    return status === p.status ? storm : { ...storm, properties: { ...p, status } };
  }
  const path = pathOf(storm);
  const fraction = seen > born ? (atMs - born) / (seen - born) : 1;
  const kept = path.slice(0, Math.max(1, Math.floor(fraction * (path.length - 1)) + 1));
  const last = kept[kept.length - 1];
  return {
    ...storm,
    geometry: { type: "Point", coordinates: last },
    properties: {
      ...p,
      path: kept.length > 1 ? { type: "LineString", coordinates: kept } : { type: "Point", coordinates: last },
      last_seen: new Date(atMs).toISOString(),
      status: "active",
      merged_into: null,
    },
  };
}

/**
 * Whether a storm is drawn: still active, or seen within the time a track
 * stays active, so a merge is drawn joined to what it merged into for a
 * while. The selected one always is.
 */
export function isDrawn(storm: Storm, reference: number, selected: string | null): boolean {
  const p = storm.properties;
  if (p.id === selected) return true;
  return p.status === "active" || ageMinutes(p.last_seen, reference) <= ACTIVE_MINUTES;
}

/** The vertex of `path` nearest `point`: where a merged storm's join meets the storm it merged into. */
export function nearestOn(path: LonLat[], point: LonLat): LonLat {
  const cos = Math.cos((point[1] * Math.PI) / 180);
  const away = (c: LonLat) => Math.hypot((c[0] - point[0]) * cos, c[1] - point[1]);
  return path.reduce((best, c) => (away(c) < away(best) ? c : best));
}

/**
 * The forecast to draw for the selected storm: its KONRAD3D track's, while
 * that track is still being detected and is the storm's primary one. Nothing
 * outside Germany, where no product forecasts a storm.
 */
export function forecastCell(selection: StormSelection | null): CellTrackProperties | null {
  const cell = selection?.cell;
  if (!cell || !cell.active || !(cell.forecast ?? []).length) return null;
  const primary = selection?.summary?.properties.primary_product;
  // A seed has no storm yet to say whose track is primary: its cell is all there is.
  if (selection?.summary && primary !== KONRAD3D) return null;
  return cell;
}

/**
 * What marks of the selection carry as their `storm`: its id, or for a cell
 * not yet found in a storm, the cell's code, so its forecast is still the
 * selected one's.
 */
export function selectedMark(selection: StormSelection | null): string | null {
  if (!selection) return null;
  if (selection.id) return selection.id;
  return selection.cell ? `cell:${selection.cell.code}` : null;
}

export interface DrawOptions {
  /** The moment drawn, ms: now, or an earlier frame's time. */
  now: number;
  /** The answer's own newest cycle, ms, which "still being seen" is asked of. */
  reference: number;
  selection: StormSelection | null;
  /** An earlier frame, ms, or null for the present. */
  at: number | null;
}

/** Every mark for these storms. */
export function drawStorms(storms: readonly Storm[], { now, reference, selection, at }: DrawOptions): StormDrawing {
  const selected = selection?.id ?? null;
  const asOf = (storm: Storm) => (at === null ? storm : stormAsOf(storm, at));
  let drawing = storms.map(asOf).filter((storm): storm is Storm => storm !== null);
  // The selected storm, from its own copy, whether or not the answer has it:
  // zoomed in on its forecast, its centroid leaves the box that was asked for.
  const pinned = selection?.summary && selected && !drawing.some((s) => s.properties.id === selected)
    ? asOf(selection.summary)
    : null;
  if (pinned) drawing = [...drawing, pinned];
  drawing = drawing.filter((storm) => isDrawn(storm, reference, selected));

  const byId = new Map(drawing.map((storm) => [storm.properties.id, storm]));
  const marks: StormMark[] = [];
  const links: StormMark[] = [];
  const pings: StormDrawing["pings"] = [];

  const liveOf = (storm: Storm) => storm.properties.status === "active"
    && isLive(ageMinutes(storm.properties.last_seen, reference));

  for (const storm of drawing) {
    const p = storm.properties;
    const target = p.merged_into ? byId.get(p.merged_into) : undefined;
    /** Merged into a storm on the map: that one carries on, so this one no longer claims to be here. */
    const taken = p.status === "merged" && target !== undefined && p.id !== selected;
    const live = liveOf(storm);
    const shared = {
      storm: p.id,
      severity: Math.min(Math.max(p.severity ?? 0, 0), 3),
      source: stormSource(storm),
      hail: Boolean(p.hail),
      meso: Boolean(p.meso),
      age_minutes: ageMinutes(p.last_seen, now),
      live,
    };
    const path = pathOf(storm);
    if (path.length > 1) {
      marks.push({ ...shared, kind: "path", id: `${p.id}:path`, geometry: { type: "LineString", coordinates: path } });
    }
    const centroid = centroidOf(storm);
    if (!taken) {
      marks.push({ ...shared, kind: "position", id: p.id, geometry: { type: "Point", coordinates: centroid } });
      if (live) {
        const history_minutes = Math.max(0, ageMinutes(p.born_at, new Date(p.last_seen).getTime()));
        pings.push({ storm: p.id, severity: shared.severity, coordinates: centroid, history_minutes });
      }
      // The list has no outlines: only the selected storm's is known, and
      // only in the present (it is its newest detection's).
      const outline = p.id === selected && at === null ? outlineOf(selection) : null;
      if (outline) {
        marks.push({ ...shared, kind: "outline", id: `${p.id}:outline`, geometry: { type: "Polygon", coordinates: [outline] } });
      }
    }
    if (target) {
      const start = path[path.length - 1];
      const t = target.properties;
      links.push({
        kind: "link",
        id: `${p.id}>${t.id}`,
        storm: t.id,
        from_storm: p.id,
        geometry: { type: "LineString", coordinates: [start, nearestOn(pathOf(target), start)] },
        severity: Math.min(Math.max(t.severity ?? 0, 0), 3),
        source: stormSource(target),
        hail: false,
        meso: false,
        age_minutes: ageMinutes(t.last_seen, now),
        live: liveOf(target),
      });
    }
    // A branch of a split, joined to where the storm it split from was then:
    // that storm's path cut back to the split, at its vertex nearest the
    // branch's first point.
    const parent = p.split_from ? byId.get(p.split_from) : undefined;
    if (parent) {
      const start = path[0];
      const then = stormAsOf(parent, new Date(p.born_at).getTime()) ?? parent;
      links.push({
        ...shared,
        kind: "link",
        id: `${parent.properties.id}>${p.id}`,
        from_storm: parent.properties.id,
        geometry: { type: "LineString", coordinates: [nearestOn(pathOf(then), start), start] },
        hail: false,
        meso: false,
      });
    }
  }

  // The forecast, for the selected storm alone and only in the present: a
  // past frame's storm is as it was then, with no forecast yet.
  const cell = at === null ? forecastCell(selection) : null;
  const storm = selected ? byId.get(selected) : undefined;
  const owner = selectedMark(selection);
  if (cell && owner) {
    const series = cell.series ?? [];
    const last = series[series.length - 1];
    const shared = {
      storm: owner,
      severity: Math.min(Math.max(storm?.properties.severity ?? cell.max_severity, 0), 3),
      source: "dwd" as const,
      hail: false,
      meso: false,
      age_minutes: ageMinutes(cell.last_seen, now),
      live: true,
    };
    (cell.forecast ?? []).forEach((point, index) => {
      marks.push({
        ...shared, kind: "forecast", id: `${owner}:fc:${index}`, geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      });
      if (!point.major_km) return;
      const ring = ellipseRing4326(point.lon, point.lat, point.major_km, point.minor_km ?? point.major_km, point.angle_deg ?? 0);
      const t = new Date(point.t).getTime();
      marks.push({
        ...shared,
        kind: "ellipse",
        id: `${owner}:el:${index}`,
        geometry: { type: "Polygon", coordinates: [ring] },
        // Labelled from the moment it is for, chosen by the lead over the
        // last detection: see layers/cells.ts `leadLabelStyle`.
        forecast_at: t,
        lead_minutes: Math.round((t - new Date(cell.last_seen).getTime()) / 60_000),
        tip: leadingTip(ring, [last?.lon ?? point.lon, last?.lat ?? point.lat]),
      });
    });
  }

  return { marks, links, pings };
}
