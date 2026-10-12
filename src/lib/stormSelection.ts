/**
 * The one selection both maps make: a storm.
 *
 * Until storms there were two, exclusive: a KONRAD3D cell (a track, with a
 * history and a forecast) and a radar volume (a box of sky, with neither),
 * joined by nothing but a point-in-box test. A storm is the identity a reader
 * means by "this storm", made of tracks from any product and domain; a
 * KONRAD3D code is one of its tracks and a volume names the patch it was cut
 * from, one of its features. So whichever of the three was tapped, the storm
 * is what is selected.
 *
 * A tap usually lands on something smaller than the storm: a cell on the 3D
 * map, a box of sky, a relative in the family chart, a link from before
 * storms. That is a *seed*: the selection opens on it at once (the panel can
 * say a good deal from a cell or a volume alone) with no storm id yet, and is
 * resolved to its storm when the backend answers (lib/stormResolver.ts).
 * Where no storm claims it (a backend without storms, an old cell), it stays
 * a seed and works as the two selections used to.
 *
 * Pure: the store is in stores.ts and the fetching in stormResolver.ts.
 */
import type {
  CellTrackProperties, RadarVolume, Storm, StormDetail, TrackerFeature, TrackerTrack,
} from "../api";
import { withKnownVolume } from "./cellTrack";

/** The products a storm's tracks come from, as `properties.tracks` names them. */
export const KONRAD3D = "dwd/konrad3d";
export const TRACKER = "meteocool/tracker";

export interface StormSelection {
  /** The storm, by id; null while it is still being found from a seed, or when none claims it. */
  id: string | null;
  /** The storm as the list has it: what the map draws and the header reads before the detail lands. */
  summary: Storm | null;
  /** The storm with its KONRAD3D tracks and tracker tracks, once fetched. */
  detail: StormDetail | null;
  /**
   * The KONRAD3D track the panel reads signals, history and forecast from:
   * the storm's primary one where it has one, or a relative walked to in the
   * family chart. Null for a storm KONRAD3D does not track.
   */
  cell: CellTrackProperties | null;
  /** The radar volume opened for it: a box tapped on the 3D map, or the storm's patch's box. */
  volume: RadarVolume | null;
}

const empty: StormSelection = { id: null, summary: null, detail: null, cell: null, volume: null };

/** A storm tapped on the flat map, or found for a seed. */
export function fromStorm(storm: Storm): StormSelection {
  return { ...empty, id: storm.properties.id, summary: storm };
}

/**
 * A storm named by id alone: a link, or a merge followed in the panel. Its
 * list copy where one is held, so the map draws it before its detail lands.
 */
export function byId(id: string, held: Iterable<Storm> = []): StormSelection {
  for (const storm of held) if (storm.properties.id === id) return fromStorm(storm);
  return { ...empty, id };
}

/** Whether the selected storm claims this KONRAD3D code, as far as is known. */
export function claimsCell(selection: StormSelection, code: string): boolean {
  if (selection.cell?.code === code) return true;
  if (selection.summary?.properties.tracks?.some((track) => track.track === code)) return true;
  if (selection.detail?.konrad3d?.some((cell) => cell.properties.code === code)) return true;
  return Boolean(selection.detail?.storm.properties.tracks?.some((track) => track.track === code));
}

/** The tracker features of a storm's detail: the features of every tracker track it claims. */
export function trackerFeatures(detail: StormDetail): TrackerFeature[] {
  return (detail.tracks ?? []).flatMap((track) => track.features ?? []);
}

/**
 * Whether a feature is the selected storm's: one of its tracks' features, or
 * the patch one of its cores sits in. A radar volume names a patch, and a
 * storm's tracker tracks are usually of cores, so it is usually the latter.
 */
export function holdsFeature(selection: StormSelection, feature: string): boolean {
  if (!selection.detail) return false;
  return trackerFeatures(selection.detail).some((own) => own.id === feature || own.parent === feature);
}

/**
 * A KONRAD3D cell selected: tapped on the 3D map, walked to in the family
 * chart, or named by a link.
 *
 * One the open storm already claims stays in that storm, only the cell shown
 * changes: walking a family within one storm is not opening another. Any
 * other cell is a seed, to be resolved to its own storm.
 */
export function withCell(current: StormSelection | null, cell: CellTrackProperties): StormSelection {
  if (current && current.id !== null && claimsCell(current, cell.code)) {
    return { ...current, cell: withKnownVolume(cell, current.cell) };
  }
  if (current && current.id === null && current.cell?.code === cell.code) {
    return { ...current, cell: withKnownVolume(cell, current.cell) };
  }
  return { ...empty, cell };
}

/** A radar volume selected: a box tapped on the 3D map, or named by a link. */
export function withVolume(current: StormSelection | null, volume: RadarVolume): StormSelection {
  const feature = volume.feature ?? null;
  if (current && current.id !== null && feature && holdsFeature(current, feature)) {
    return { ...current, volume };
  }
  return { ...empty, volume };
}

/**
 * The storm's list copy: the answer to a seed's lookup, or a newer copy of
 * the open storm from a refresh. A seed keeps what it was opened on.
 */
export function withStorm(current: StormSelection | null, storm: Storm): StormSelection {
  const id = storm.properties.id;
  if (current && (current.id === id || current.id === null)) {
    // Found for a seed: a detail fetched while looking (`withDetail`) is kept if it is this storm's.
    const detail = current.detail?.storm.id === id ? current.detail : null;
    return { ...current, id, summary: storm, detail };
  }
  return fromStorm(storm);
}

/**
 * The KONRAD3D track to show for a storm: its primary track where that is
 * KONRAD3D's, else the most recently seen one it claims, else none.
 */
export function primaryCell(detail: StormDetail): CellTrackProperties | null {
  const cells = (detail.konrad3d ?? []).map((cell) => cell.properties);
  if (!cells.length) return null;
  const { primary_product: product, primary_track: track } = detail.storm.properties;
  if (product === KONRAD3D && track) {
    const primary = cells.find((cell) => cell.code === track);
    if (primary) return primary;
  }
  return cells.reduce((newest, cell) => (cell.last_seen > newest.last_seen ? cell : newest));
}

/**
 * The fetched storm, for the storm it was fetched for.
 *
 * The cell shown is kept if the storm claims it (a relative walked to, or
 * the cell a seed was), refreshed from the detail's copy; otherwise the
 * storm's own. A detail for a storm no longer selected changes nothing.
 */
export function withDetail(current: StormSelection | null, detail: StormDetail): StormSelection | null {
  if (!current || current.id !== detail.storm.id) return current;
  const cells = (detail.konrad3d ?? []).map((cell) => cell.properties);
  const shown = current.cell ? cells.find((cell) => cell.code === current.cell!.code) : undefined;
  let cell: CellTrackProperties | null;
  if (shown) cell = withKnownVolume(shown, current.cell);
  else if (current.cell && claimsCell(current, current.cell.code)) cell = current.cell;
  else cell = primaryCell(detail);
  return { ...current, summary: detail.storm, detail, cell };
}

/** What a seed is looked up by, or null when the selection is not a seed. */
export function lookupOf(selection: StormSelection | null): { cell: string } | { feature: string } | null {
  if (!selection || selection.id !== null) return null;
  if (selection.cell) return { cell: selection.cell.code };
  if (selection.volume?.feature) return { feature: selection.volume.feature };
  return null;
}

/**
 * The selection as one comparable string: the storm once known, else the
 * seed. What decides whether the slice is reset, the URL pushed, the 3D map
 * reframed.
 */
export function selectionKey(selection: StormSelection | null): string {
  if (!selection) return "";
  if (selection.id) return `storm:${selection.id}`;
  if (selection.cell) return `cell:${selection.cell.code}`;
  if (selection.volume) return `cloud:${selection.volume.path}`;
  return "";
}

/**
 * Whether going from one selection to the other only found the storm a seed
 * belongs to. The same thing on screen, under its proper name: not a new
 * selection, so not a history entry, a re-cut or a reframing.
 */
export function isResolution(from: StormSelection | null, to: StormSelection | null): boolean {
  if (!from || !to || from.id !== null || to.id === null) return false;
  if (from.cell) return to.cell?.code === from.cell.code;
  if (from.volume) return to.volume?.path === from.volume.path;
  return false;
}

/**
 * Whether the storm's severity is DWD's, which the panel may name as a class:
 * it has a KONRAD3D track. Elsewhere it is derived from the peak alone, and
 * the panel says what the peak is rather than calling it a class.
 */
export function knowsSeverity(selection: StormSelection): boolean {
  return Boolean(selection.cell) || selection.summary?.properties.primary_product === KONRAD3D;
}

/** The storm's severity class, 0..3, or null when there is nothing to take one from. */
export function severityOf(selection: StormSelection): number | null {
  const value = selection.summary?.properties.severity ?? selection.cell?.max_severity ?? null;
  return value === null ? null : Math.min(Math.max(value, 0), 3);
}

/** Where the storm is now, as [lon, lat]: its centroid, else its cell's newest step, else its box. */
export function positionOf(selection: StormSelection): [number, number] | null {
  const centroid = selection.summary?.geometry.coordinates;
  if (centroid && centroid.length >= 2) return [centroid[0], centroid[1]];
  const series = selection.cell?.series ?? [];
  const last = series[series.length - 1];
  if (last) return [last.lon, last.lat];
  if (selection.volume) return [selection.volume.lon, selection.volume.lat];
  return null;
}

/**
 * Which way the storm is going, for the slice to start along: the KONRAD3D
 * track's newest heading, else the storm's own, else none (the slice starts
 * north to south).
 */
export function headingOf(selection: StormSelection): number | null {
  const series = selection.cell?.series ?? [];
  const last = series[series.length - 1];
  return last?.heading_deg ?? selection.summary?.properties.heading_deg ?? null;
}

/**
 * The tracker track whose history to show: the storm's primary one where
 * that is the tracker's, else the most recently seen it claims.
 */
export function primaryTrackerTrack(detail: StormDetail): TrackerTrack | null {
  const tracks = detail.tracks ?? [];
  if (!tracks.length) return null;
  const primary = tracks.find((track) => track.id === detail.storm.properties.primary_track);
  return primary ?? tracks.reduce((newest, track) => (track.last_seen > newest.last_seen ? track : newest));
}

/**
 * The patches the storm's newest features are or sit in, by id: what its
 * radar volumes name.
 */
export function newestPatches(selection: StormSelection): string[] {
  if (!selection.detail) return [];
  const features = trackerFeatures(selection.detail);
  if (!features.length) return [];
  const newest = features.reduce((latest, feature) => (feature.valid_at > latest ? feature.valid_at : latest), "");
  return [...new Set(features
    .filter((feature) => feature.valid_at === newest)
    .map((feature) => (feature.kind === "patch" ? feature.id : feature.parent))
    .filter((id): id is string => Boolean(id)))];
}

/**
 * The radar volume to cut the storm open by, from the volumes listed now.
 *
 * Those cut from one of its newest patches: a patch is boxed by every map
 * tile it covers, so there are several, and the one nearest the storm's
 * centroid is where its core is. Null when none of its patches was boxed
 * (only the strongest are), or the volumes do not say which patch they are
 * of (`RadarVolume.feature` is absent).
 */
export function volumeOfStorm(volumes: readonly RadarVolume[], selection: StormSelection): RadarVolume | null {
  const patches = new Set(newestPatches(selection));
  if (!patches.size) return null;
  const own = volumes.filter((volume) => !volume.coarse && volume.feature && patches.has(volume.feature));
  if (!own.length) return null;
  const at = positionOf(selection);
  if (!at) return own[0];
  const away = (volume: RadarVolume) => Math.hypot(
    (volume.lon - at[0]) * Math.cos((at[1] * Math.PI) / 180),
    volume.lat - at[1],
  );
  return own.reduce((best, volume) => (away(volume) < away(best) ? volume : best));
}

/** One step of a storm's history from meteocool's tracker. */
export interface StormStep {
  t: string;
  /** Peak reflectivity, dBZ. */
  peak_dbz: number | null;
  /** The feature's area, km², at the threshold it was found at. */
  area_km2: number | null;
}

/**
 * The storm's history from the tracker: its primary tracker track's features
 * of the last hour, oldest first, one per frame. For a storm KONRAD3D does
 * not track, which is all the history there is.
 */
export function trackerSeries(detail: StormDetail): StormStep[] {
  const track = primaryTrackerTrack(detail);
  if (!track) return [];
  const byFrame = new Map<string, StormStep>();
  for (const feature of track.features ?? []) {
    const known = byFrame.get(feature.valid_at);
    if (!known || feature.peak_dbz > (known.peak_dbz ?? -Infinity)) {
      byFrame.set(feature.valid_at, { t: feature.valid_at, peak_dbz: feature.peak_dbz, area_km2: feature.area_km2 });
    }
  }
  return [...byFrame.values()].sort((a, b) => a.t.localeCompare(b.t));
}

/** The storms that merged into this one, of those held. */
export function mergedInto(storms: Iterable<Storm>, id: string): Storm[] {
  return [...storms].filter((storm) => storm.properties.merged_into === id && storm.properties.id !== id);
}

/**
 * The selected storm's outline now, as a [lon, lat] ring: its KONRAD3D
 * cell's where that track is primary, else its newest tracker feature's.
 * The list carries no outlines, so only the selected storm has one drawn.
 */
export function outlineOf(selection: StormSelection | null): [number, number][] | null {
  if (!selection) return null;
  const primary = selection.summary?.properties.primary_product;
  const polygon = selection.cell?.polygon;
  if (polygon && polygon.length > 2 && (!selection.summary || primary === KONRAD3D)) {
    return polygon.map((c) => [c[0], c[1]]);
  }
  const track = selection.detail ? primaryTrackerTrack(selection.detail) : null;
  const features = track?.features ?? [];
  if (!features.length) return null;
  const newest = features.reduce((latest, feature) => (feature.valid_at > latest.valid_at ? feature : latest));
  const ring = newest.outline?.coordinates?.[0];
  return ring && ring.length > 2 ? ring.map((c) => [c[0], c[1]]) : null;
}

/** The storm among these that claims a KONRAD3D code, by its list of tracks. */
export function stormClaiming(storms: Iterable<Storm>, code: string): Storm | null {
  for (const storm of storms) {
    if (storm.properties.tracks?.some((claim) => claim.track === code)) return storm;
  }
  return null;
}

/**
 * The storms nearest a point, nearest first, at most `count` and within
 * `withinKm`: the ones worth fetching in full to find which holds a feature,
 * since the list does not name features.
 */
export function nearestStorms(storms: Iterable<Storm>, at: [number, number], withinKm: number, count: number): Storm[] {
  const kmPerLon = 111.32 * Math.cos((at[1] * Math.PI) / 180);
  const away = (storm: Storm) => {
    const [lon, lat] = storm.geometry.coordinates;
    return Math.hypot((lon - at[0]) * kmPerLon, (lat - at[1]) * 111.32);
  };
  const unique = new Map<string, Storm>();
  for (const storm of storms) unique.set(storm.properties.id, storm);
  return [...unique.values()]
    .map((storm) => ({ storm, km: away(storm) }))
    .filter(({ km }) => km <= withinKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, count)
    .map(({ storm }) => storm);
}
