/**
 * The radars that saw the storm being looked into, as beams of light from
 * each of them to its mark: where the picture of the storm came from, laid
 * over the view as a head-up display would lay it.
 *
 * Which radars: the ones its volume was built from (`sites` on the listed
 * volumes), the volume nearest the mark and any other close enough to be
 * the same storm. A beam is brighter the lower that radar saw into the
 * storm, since a beam that only reaches it high above its base says less
 * about it than one that sees it whole; the nearest first.
 *
 * Where each beam is on the screen is worked out here from points in the
 * eye's frame, so it is testable without a map or a canvas: sampled along
 * the beam, broken where it goes behind the eye or, from the seat, out of
 * the windows. Drawing it is the flight deck's (components/studio/flight/rays.ts).
 */
import { beamHeightKm, distanceKm, radarSite } from "../../radarSites";
import type { StormTileInfo } from "../director";
import type { Vec3 } from "./view";

/** Volumes this near the storm's mark count as its own, km: a storm's core spans a tile or two. */
export const RAY_TILES_KM = 25;
/** Past this, the nearest volume is another storm's, km, and the mark has no radars to show. */
export const RAY_NEAREST_KM = 40;
/** The most beams drawn at once: beyond this, more radars only make a fan nobody can read. */
export const RAYS_MOST = 8;
/** Points sampled along each beam: enough that a beam broken by a window frame breaks near where it is. */
export const RAY_SAMPLES = 48;

/** A radar a beam is drawn from, and what it saw of the storm. */
export interface RayRadar {
  code: string;
  name: string;
  lon: number;
  lat: number;
  /** The antenna, true metres above the sea. */
  heightM: number;
  /** From the radar to the storm, km. */
  distanceKm: number;
  /** How high its lowest beam is over the storm, km above the sea. */
  beamKm: number;
  /** How bright its beam is drawn, 0 to 1. */
  strength: number;
}

/** A point of a beam on the screen: across and down it, 0 to 1 each; and how far along, 0 at the radar and 1 at the storm. */
export interface RayPoint {
  x: number;
  y: number;
  t: number;
}

/** The faintest a beam is drawn, for a radar that only saw the storm's top. */
export const RAY_FAINTEST = 0.35;

/**
 * How bright a radar's beam is from how high it saw the storm: whole below
 * a kilometre, where it sees all but the lowest cloud, and fading to the
 * faintest by five, where it sees only an anvil.
 */
export function rayStrength(beamKm: number): number {
  const share = Math.min(1, Math.max(0, (beamKm - 1) / 4));
  return 1 - share * (1 - RAY_FAINTEST);
}

type Tile = Pick<StormTileInfo, "lon" | "lat" | "coarse" | "sites">;

/**
 * The radars a storm at a place was built from: those of the volumes
 * within `RAY_TILES_KM` of it, or of the nearest one where none is, unless
 * that is further off than `RAY_NEAREST_KM`. The finer volumes where there
 * are any, since a coarse one covers forty kilometres of sky. Radars the
 * table does not know are left out: a beam needs a place to start from.
 */
export function radarsOf(at: { lon: number; lat: number }, tiles: readonly Tile[]): RayRadar[] {
  const fine = tiles.filter((tile) => !tile.coarse);
  const measured = (fine.length ? fine : tiles)
    .map((tile) => ({ tile, km: distanceKm(at.lat, at.lon, tile.lat, tile.lon) }))
    .sort((a, b) => a.km - b.km);
  const near = measured.filter(({ km }) => km <= RAY_TILES_KM);
  const chosen = near.length ? near : measured.slice(0, 1).filter(({ km }) => km <= RAY_NEAREST_KM);
  const codes = new Set(chosen.flatMap(({ tile }) => tile.sites ?? []).map((code) => code.toLowerCase()));
  const radars: RayRadar[] = [];
  for (const code of codes) {
    const site = radarSite(code);
    if (!site) continue;
    const range = distanceKm(site.lat, site.lon, at.lat, at.lon);
    // A site named twice, bare and with its country (`isn`, `deisn`), is one radar.
    if (radars.some((radar) => radar.lon === site.lon && radar.lat === site.lat)) continue;
    const beamKm = beamHeightKm(range, site.lowestDeg, site.heightM);
    radars.push({
      code, name: site.name, lon: site.lon, lat: site.lat, heightM: site.heightM,
      distanceKm: range, beamKm, strength: rayStrength(beamKm),
    });
  }
  return radars.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, RAYS_MOST);
}

/**
 * A beam from `from` to `to`, both in the eye's frame (metres north, east
 * and down of it), as runs of points on the screen: `project` places a
 * point (null where it is behind the eye) and `visible` says whether it can
 * be seen at all (from the seat, through a window). A run ends where the
 * beam stops being seen and the next begins where it is seen again.
 */
export function rayRuns(
  from: Vec3, to: Vec3,
  project: (point: Vec3) => { x: number; y: number } | null,
  visible: (point: Vec3) => boolean = () => true,
  samples = RAY_SAMPLES,
): RayPoint[][] {
  const runs: RayPoint[][] = [];
  let run: RayPoint[] = [];
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const point: Vec3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
    const at = visible(point) ? project(point) : null;
    if (at) {
      run.push({ x: at.x, y: at.y, t });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  // A run of one point is no line.
  return runs.filter((points) => points.length > 1);
}

/** Where along a beam's runs a share of the way from the radar is, on the screen; null where that part is not seen. */
export function pointAlong(runs: readonly RayPoint[][], t: number): { x: number; y: number } | null {
  for (const points of runs) {
    for (let index = 1; index < points.length; index++) {
      const [a, b] = [points[index - 1], points[index]];
      if (t < a.t || t > b.t) continue;
      const share = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
    }
  }
  return null;
}

/** How far out from the storm a beam has grown, 0 to 1, this long after the storm was picked: quickly, then settling. */
export const RAY_GROW_S = 0.9;
export function rayGrowth(seconds: number): number {
  const share = Math.min(1, Math.max(0, seconds / RAY_GROW_S));
  return 1 - (1 - share) ** 3;
}

/** A beam's runs from `from` (0 at the radar) on, the run it starts in cut where it starts. */
export function runsFrom(runs: readonly RayPoint[][], from: number): RayPoint[][] {
  if (from <= 0) return runs.map((points) => [...points]);
  const kept: RayPoint[][] = [];
  for (const points of runs) {
    const after = points.findIndex((point) => point.t >= from);
    if (after < 0) continue;
    const trimmed = points.slice(after);
    const before = points[after - 1];
    if (before) {
      const first = points[after];
      const share = (from - before.t) / (first.t - before.t);
      trimmed.unshift({ x: before.x + (first.x - before.x) * share, y: before.y + (first.y - before.y) * share, t: from });
    }
    if (trimmed.length > 1) kept.push(trimmed);
  }
  return kept;
}
