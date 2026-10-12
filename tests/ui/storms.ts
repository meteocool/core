import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURES, type RecordedResponse } from "./offline";

/**
 * `/storms`, stood in for until the backend that records the fixtures
 * serves it (staging does not yet).
 *
 * Made from what is recorded: each recorded KONRAD3D track is a storm whose
 * primary track it is, as storms over Germany usually are. Specs that
 * need more (a storm outside Germany, a box of sky's storm) add their own
 * through `serveStorms`. Once a recording has `/storms`, offline.ts plays
 * that instead.
 */

type Json = Record<string, any>;

const recorded = (name: string): Json => (JSON.parse(
  readFileSync(path.join(FIXTURES, "api", `${name}.json`), "utf8"),
) as RecordedResponse).json as Json;

/** A storm id for a KONRAD3D code, in the backend's shape, the code's digits in it. */
export const stormIdOf = (code: string): string => `01K${code}Z`.slice(0, 26).padEnd(26, "Z");

/** The patch a recorded volume is said to be cut from, as the backend will name it. */
export const patchOf = (volume: Json): string => `meteocool/tracker/${volume.network}/stand-in/patch/${volume.system ?? volume.code}`;

const bounds = (coordinates: number[][]) => ({
  west: Math.min(...coordinates.map((c) => c[0])),
  south: Math.min(...coordinates.map((c) => c[1])),
  east: Math.max(...coordinates.map((c) => c[0])),
  north: Math.max(...coordinates.map((c) => c[1])),
});

/** A storm and its detail, from one recorded KONRAD3D track. */
export function stormOfTrack(track: Json): { storm: Json; detail: Json } {
  const p = track.properties;
  const coordinates: number[][] = track.geometry.type === "LineString" ? track.geometry.coordinates : [track.geometry.coordinates];
  const last = coordinates[coordinates.length - 1];
  const id = stormIdOf(p.code);
  const storm = {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: last },
    properties: {
      id,
      born_at: p.first_seen,
      last_seen: p.last_seen,
      status: p.active ? "active" : "ended",
      merged_into: null,
      primary_track: p.code,
      primary_product: "dwd/konrad3d",
      primary_domain: "de",
      heading_deg: p.series?.[p.series.length - 1]?.heading_deg ?? null,
      speed_kmh: p.series?.[p.series.length - 1]?.speed_kmh ?? null,
      severity: p.max_severity,
      peak_dbz: p.max_dbz,
      hail: p.hail_ever,
      meso: p.meso_ever,
      placement: p.placement ?? null,
      bbox: bounds(coordinates),
      path: coordinates.length > 1 ? { type: "LineString", coordinates } : { type: "Point", coordinates: last },
      tracks: [{ product: "dwd/konrad3d", domain: "de", track: p.code }],
    },
  };
  const detail = {
    storm,
    konrad3d: [track],
    tracks: [],
  };
  return { storm, detail };
}

/**
 * A storm only meteocool's tracker follows, around one recorded volume: the
 * storm the box is a part of, outside Germany if the volume is.
 */
export function stormOfVolume(volume: Json, id: string): { storm: Json; detail: Json } {
  const t = volume.reference_time;
  const earlier = new Date(new Date(t).getTime() - 10 * 60_000).toISOString();
  const coordinates = [[volume.lon - 0.05, volume.lat - 0.02], [volume.lon, volume.lat]];
  const track = `meteocool/tracker/${volume.network}/stand-in/core/${volume.code}`;
  const core = (at: string, lon: number, lat: number, peak: number, area: number) => ({
    id: `${track}@${at}`,
    kind: "core",
    valid_at: at,
    parent: patchOf(volume),
    centroid: { type: "Point", coordinates: [lon, lat] },
    peak: { type: "Point", coordinates: [lon, lat] },
    peak_dbz: peak,
    area_km2: area,
    outline: { type: "Polygon", coordinates: [[[lon - 0.03, lat - 0.02], [lon + 0.03, lat - 0.02], [lon, lat + 0.03], [lon - 0.03, lat - 0.02]]] },
  });
  const storm = {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [volume.lon, volume.lat] },
    properties: {
      id,
      born_at: earlier,
      last_seen: t,
      status: "active",
      merged_into: null,
      primary_track: track,
      primary_product: "meteocool/tracker",
      primary_domain: volume.network,
      heading_deg: 70,
      speed_kmh: 35,
      severity: 1,
      peak_dbz: volume.peak_dbz ?? 45,
      hail: false,
      meso: false,
      placement: null,
      bbox: bounds(coordinates),
      path: { type: "LineString", coordinates },
      tracks: [{ product: "meteocool/tracker", domain: volume.network, track }],
    },
  };
  const detail = {
    storm,
    konrad3d: [],
    tracks: [{
      id: track,
      product: "meteocool/tracker",
      domain: volume.network,
      kind: "core",
      first_seen: earlier,
      last_seen: t,
      active: true,
      max_peak_dbz: volume.peak_dbz ?? 45,
      bbox: bounds(coordinates),
      path: { type: "LineString", coordinates },
      n_features: 2,
      features: [
        core(earlier, coordinates[0][0], coordinates[0][1], (volume.peak_dbz ?? 45) - 3, 18),
        core(t, volume.lon, volume.lat, volume.peak_dbz ?? 45, 24),
      ],
    }],
  };
  return { storm, detail };
}

/** The storms made from the recorded KONRAD3D tracks. */
export function recordedStorms(): { storm: Json; detail: Json }[] {
  return (recorded("GET_cells_tracks").features as Json[]).map(stormOfTrack);
}

/** Answer `/storms` and `/storms/{id}` from these storms. */
export function answerStorms(route: Route, url: URL, storms: { storm: Json; detail: Json }[]): Promise<void> {
  const id = /^\/storms\/([^/]+)$/.exec(url.pathname)?.[1];
  if (id) {
    const found = storms.find(({ storm }) => storm.id === id);
    return found
      ? route.fulfill({ json: found.detail })
      : route.fulfill({ status: 404, json: { detail: "unknown storm" } });
  }
  return route.fulfill({ json: { type: "FeatureCollection", features: storms.map(({ storm }) => storm) } });
}

/** Serve these storms, beside the recorded ones, for the rest of the test. */
export async function serveStorms(page: Page, extra: { storm: Json; detail: Json }[]): Promise<void> {
  const storms = [...recordedStorms(), ...extra];
  await page.route(/\/storms(\/|\?|$)/, (route) => answerStorms(route, new URL(route.request().url()), storms));
}
