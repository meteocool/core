/**
 * Storms, cells and volumes for the storm tests, in the shapes the data
 * service sends them, each with only what the test at hand changes.
 */
import type {
  CellTrackProperties, RadarVolume, Storm, StormDetail, StormProperties, TrackerFeature, TrackerTrack,
} from "../../src/api/index.ts";

export const T0 = Date.UTC(2026, 9, 12, 14, 0);
export const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

/** A storm id in the backend's shape, distinct per letter. */
export const sid = (letter: string): string => `01JA${letter.repeat(22)}`.slice(0, 26);

export function storm(id: string, properties: Partial<StormProperties> = {}, path: number[][] = [[10, 50], [10.1, 50.05]]): Storm {
  const last = path[path.length - 1];
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: last },
    properties: {
      id,
      born_at: at(-60),
      last_seen: at(0),
      status: "active",
      severity: 1,
      hail: false,
      meso: false,
      bbox: { west: 10, south: 50, east: 10.1, north: 50.05 },
      path: path.length > 1 ? { type: "LineString", coordinates: path } : { type: "Point", coordinates: last },
      tracks: [],
      ...properties,
    },
  };
}

export function cell(code: string, properties: Partial<CellTrackProperties> = {}): CellTrackProperties {
  return {
    code,
    first_seen: at(-30),
    last_seen: at(0),
    n_steps: 2,
    active: true,
    max_severity: 2,
    hail_ever: false,
    meso_ever: false,
    split_ever: false,
    merge_ever: false,
    hail_minutes: 0,
    meso_minutes: 0,
    lightning_jump_recent: false,
    intensifying: false,
    parent_codes: [],
    child_codes: [],
    series: [
      { t: at(-5), lon: 10, lat: 50, severity: 2, heading_deg: 80 },
      { t: at(0), lon: 10.1, lat: 50.05, severity: 2, heading_deg: 90 },
    ],
    forecast: [],
    structure: [],
    ...properties,
  } as CellTrackProperties;
}

export function volume(path: string, properties: Partial<RadarVolume> = {}): RadarVolume {
  return {
    path,
    coverage: 1,
    code: path,
    lon: 10.1,
    lat: 50.05,
    reference_time: at(0),
    coarse: false,
    ...properties,
  } as RadarVolume;
}

export function feature(id: string, minutes: number, properties: Partial<TrackerFeature> = {}): TrackerFeature {
  return {
    id,
    kind: "core",
    valid_at: at(minutes),
    parent: null,
    centroid: { type: "Point", coordinates: [10.1, 50.05] },
    peak: { type: "Point", coordinates: [10.1, 50.05] },
    peak_dbz: 50,
    area_km2: 20,
    outline: { type: "Polygon", coordinates: [[[10, 50], [10.2, 50], [10.2, 50.1], [10, 50]]] },
    ...properties,
  };
}

export function trackerTrack(id: string, features: TrackerFeature[], properties: Partial<TrackerTrack> = {}): TrackerTrack {
  return {
    id,
    product: "meteocool/tracker",
    domain: "de",
    kind: "core",
    first_seen: features[0]?.valid_at ?? at(-30),
    last_seen: features[features.length - 1]?.valid_at ?? at(0),
    active: true,
    max_peak_dbz: 55,
    bbox: { west: 10, south: 50, east: 10.1, north: 50.05 },
    path: { type: "Point", coordinates: [10.1, 50.05] },
    n_features: features.length,
    features,
    ...properties,
  };
}

export function detail(of: Storm, parts: Partial<Omit<StormDetail, "storm">> = {}): StormDetail {
  return { storm: of, konrad3d: [], tracks: [], ...parts };
}

/** A KONRAD3D track as the detail carries it. */
export function trackFeature(properties: CellTrackProperties): NonNullable<StormDetail["konrad3d"]>[number] {
  return {
    type: "Feature",
    id: properties.code,
    geometry: { type: "LineString", coordinates: (properties.series ?? []).map((step) => [step.lon, step.lat]) },
    properties,
  } as NonNullable<StormDetail["konrad3d"]>[number];
}
