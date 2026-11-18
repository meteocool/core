/**
 * Storms that are one system: the groups `/storms/groups` outlines, and how
 * the map and the panel use them.
 *
 * A group is two or more storms the backend counts as one system (its storms
 * share `group`), drawn as one quiet outline under their marks
 * (layers/stormGroups.ts) and named in a storm's panel by how many storms it
 * has. Pure, and free of OpenLayers, so the rules can be tested.
 */
import type { Storm, StormGroup } from "../api";
import { ACTIVE_MINUTES, OUTLINE_MAX_MINUTES } from "./cellGeometry";
import { STEP_S } from "./archive";

type LonLat = [number, number];

/**
 * The statuses that mean a backend has no groups: a 404, or a 422 from one
 * whose `/storms/{id}` reads `groups` as a storm's id. Both are a map
 * without outlines, said nowhere and not asked again at once.
 */
export const GROUPS_ABSENT: readonly number[] = [404, 422];

/**
 * How long a backend that had no groups is left alone before it is asked
 * again. Every pan asks for storms, and on a backend from before groups each
 * would bring a second request that can only fail; a backend updated under
 * an open map gets its outlines within this, or on the next load.
 */
export const GROUPS_RECHECK_MS = 30 * 60_000;

/** Whether to ask for groups now, given when a backend last had none (null: never). */
export function asksForGroups(absentAt: number | null, now: number): boolean {
  return absentAt === null || now - absentAt >= GROUPS_RECHECK_MS;
}

/**
 * How far a group's outline may be from the radar frame on screen and still
 * be that frame's: half a step of the radar's grid. Further, and it is an
 * earlier or a later frame's shape, drawn dashed (layers/stormGroups.ts): a
 * new scan lands before its systems do, and in that gap the echoes have
 * moved on from the line round them.
 */
export const CURRENT_WITHIN_MS = (STEP_S * 1000) / 2;

/** Whether a group's outline is the one for the frame at `moment`, ms. */
export function outlineCurrentAt(group: StormGroup, moment: number): boolean {
  const seen = Date.parse(group.properties.last_seen);
  return Number.isFinite(seen) && Math.abs(seen - moment) <= CURRENT_WITHIN_MS;
}

/** One group's outline, as the map draws it. */
export interface GroupOutline {
  id: string;
  /** Its polygons, each its rings of [lon, lat], outer first. */
  polygons: LonLat[][][];
  /** How many storms it has. */
  storms: number;
  severity: number;
  /** Whether it is another frame's shape than the one at the moment drawn. */
  stale: boolean;
}

/** A ring that is one: at least four positions, closed or not. */
const ringOf = (ring: unknown): LonLat[] | null => {
  if (!Array.isArray(ring)) return null;
  const positions = ring
    .filter((c): c is number[] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c): LonLat => [c[0], c[1]]);
  return positions.length >= 4 ? positions : null;
};

/** A group's polygons, from a MultiPolygon or, leniently, a Polygon; none from anything else. */
function polygonsOf(geometry: { type?: string; coordinates?: unknown } | null | undefined): LonLat[][][] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polygons = geometry.type === "MultiPolygon"
    ? geometry.coordinates
    : geometry.type === "Polygon" ? [geometry.coordinates] : [];
  return polygons
    .map((polygon) => (Array.isArray(polygon) ? polygon.map(ringOf) : []))
    // A polygon whose outer ring is no ring is nothing; a bad hole is left out.
    .filter((rings) => rings.length > 0 && rings[0] !== null)
    .map((rings) => rings.filter((ring): ring is LonLat[] => ring !== null));
}

/**
 * Whether a group is drawn at `moment`, ms: born by then, seen within the
 * time a storm stays active of it, and its outline (which is its newest)
 * no further ahead of it than an outline keeps describing a storm. In the
 * present that is every group still going; on an earlier frame, the ones
 * whose outline was close to where they were then.
 */
export function groupShownAt(group: StormGroup, moment: number): boolean {
  const born = Date.parse(group.properties.born_at);
  const seen = Date.parse(group.properties.last_seen);
  if (!Number.isFinite(born) || !Number.isFinite(seen) || born > moment) return false;
  return moment - seen <= ACTIVE_MINUTES * 60_000 && seen - moment <= OUTLINE_MAX_MINUTES * 60_000;
}

/**
 * The outlines to draw at `moment`: one per group of two or more storms
 * with an area to outline, each marked stale when it is not that moment's.
 * The backend lists only those; anything else is left out rather than
 * drawn wrong.
 */
export function groupOutlines(groups: readonly StormGroup[], moment: number): GroupOutline[] {
  const outlines: GroupOutline[] = [];
  for (const group of groups) {
    const p = group?.properties;
    if (!p || !Array.isArray(p.storms) || p.storms.length < 2 || !groupShownAt(group, moment)) continue;
    const polygons = polygonsOf(group.geometry);
    if (!polygons.length) continue;
    outlines.push({
      id: String(group.id ?? p.id),
      polygons,
      storms: p.storms.length,
      severity: Math.min(Math.max(p.severity ?? 0, 0), 3),
      stale: !outlineCurrentAt(group, moment),
    });
  }
  return outlines;
}

/**
 * How many storms the system `storm` belongs to has, for its panel, or null
 * when it is in none of two or more. The group's own list when the groups
 * answer has it; otherwise the storms held that share its id, which is what
 * a backend's storms say when its groups are out of view or not yet in.
 */
export function systemSize(
  storm: Pick<Storm, "properties"> | null | undefined,
  groups: readonly StormGroup[],
  held: readonly Storm[],
): number | null {
  const id = storm?.properties.group;
  if (!id) return null;
  const group = groups.find((candidate) => (candidate.id ?? candidate.properties?.id) === id);
  const count = group && Array.isArray(group.properties?.storms)
    ? group.properties.storms.length
    : new Set([storm.properties.id, ...held.filter((other) => other.properties.group === id).map((other) => other.properties.id)]).size;
  return count >= 2 ? count : null;
}
