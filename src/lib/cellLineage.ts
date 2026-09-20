import type { CellTrackProperties } from "../api";

/**
 * A storm's family: what it split from, what it merged with, what it became.
 *
 * DWD's tracker records both directions -- `parent_codes` and `child_codes` --
 * and the two agree, so the family is a DAG rather than a tree: a cell can
 * have several parents (a merge) and several children (a split), and the same
 * lineage can do both within an hour. In one sampled run the largest family
 * was seven cells over three generations with a merge and a split in it.
 *
 * Two thirds of what this has to handle is a single cell with no relatives at
 * all -- 145 of 200 tracks in that run -- so the caller checks for that and
 * draws nothing. It is the severe ones that have families: 8% of weak cells
 * carried lineage edges against 72% of the strong ones, which is the argument
 * for the chart existing at all.
 *
 * Assembly is here, free of both OpenLayers and the layout library, because
 * the fiddly parts are graph bookkeeping rather than drawing: an edge is
 * listed by both of its endpoints and must be emitted once, a relative may not
 * have been fetched yet and must not become a node, and a walk over data this
 * shape has to be bounded whatever the feed does.
 */

export interface LineageNode {
  code: string;
  severity: number;
  firstSeen: string;
  lastSeen: string;
  peakDbz: number | null;
  hail: boolean;
  meso: boolean;
  /** The cell whose panel is open, which is drawn as the one you are on. */
  self: boolean;
}

export interface LineageEdge {
  /** The parent, always: edges run the way time does. */
  from: string;
  to: string;
}

export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export const EMPTY_LINEAGE: Lineage = { nodes: [], edges: [] };

/**
 * As far as the walk will go.
 *
 * Nothing observed comes close -- the largest family seen was seven -- but
 * this walks a graph built from an upstream identifier that is documented as
 * being reused across unrelated cells, and a chart is not the place to find
 * out what that does to a traversal.
 */
export const MAX_FAMILY = 24;

/** Every code a track names as a relative, in no particular order. */
export function relativesOf(track: CellTrackProperties): string[] {
  return [...(track.parent_codes ?? []), ...(track.child_codes ?? [])];
}

/**
 * The codes reachable from `rootCode` through `known`, breadth first.
 *
 * Only codes already in `known` are followed, so this is also what decides
 * which relatives still need fetching: run it, compare against the relatives
 * the reached tracks name, and fetch the difference.
 */
export function reachable(
  known: Map<string, CellTrackProperties>,
  rootCode: string,
  limit = MAX_FAMILY,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [rootCode];
  while (queue.length && order.length < limit) {
    const code = queue.shift() as string;
    if (seen.has(code)) continue;
    seen.add(code);
    const track = known.get(code);
    if (!track) continue;
    order.push(code);
    relativesOf(track).forEach((other) => {
      if (!seen.has(other)) queue.push(other);
    });
  }
  return order;
}

/** The relatives named by what has been reached but not themselves fetched. */
export function missingRelatives(
  known: Map<string, CellTrackProperties>,
  rootCode: string,
): string[] {
  const have = new Set(reachable(known, rootCode));
  const wanted = new Set<string>();
  have.forEach((code) => {
    const track = known.get(code);
    if (!track) return;
    relativesOf(track).forEach((other) => {
      if (!known.has(other)) wanted.add(other);
    });
  });
  return [...wanted];
}

/**
 * The family around `rootCode`, as nodes and edges ready to be laid out.
 *
 * Edges are emitted from the child's `parent_codes` only. Both endpoints carry
 * the relationship and taking it from both would double every edge; taking it
 * from the child also means an edge appears exactly when the node it points
 * into exists, which is what keeps a half-fetched family drawable.
 */
export function buildLineage(
  known: Map<string, CellTrackProperties>,
  rootCode: string,
): Lineage {
  const codes = reachable(known, rootCode);
  if (codes.length < 2) return EMPTY_LINEAGE;
  const inGraph = new Set(codes);

  const nodes: LineageNode[] = codes.map((code) => {
    const track = known.get(code) as CellTrackProperties;
    return {
      code,
      severity: Math.min(Math.max(track.max_severity, 0), 3),
      firstSeen: track.first_seen,
      lastSeen: track.last_seen,
      peakDbz: track.max_dbz ?? null,
      hail: Boolean(track.hail_ever),
      meso: Boolean(track.meso_ever),
      self: code === rootCode,
    };
  });
  /*
   * Oldest first, and the code settles a tie.
   *
   * The tie-break is not cosmetic. `reachable` walks outwards from whichever
   * cell is open, so it returns the same family in a different order depending
   * on which node you are standing on -- and a family really does contain
   * cells that start in the same minute, two of them reading 16:45 in the run
   * this was built against. Sorting on the timestamp alone leaves those two in
   * traversal order, which the layout then reflects: walk to a relative and
   * the graph comes back with a pair of nodes swapped, under a cursor that has
   * not moved. A total order makes the layout a property of the family rather
   * than of the route taken into it.
   *
   * One case is still root-dependent, and is left so: a family past
   * `MAX_FAMILY` is truncated at whatever the walk reached first. The largest
   * seen is seven against a cap of twenty-four.
   */
  nodes.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.code.localeCompare(b.code));

  const edges: LineageEdge[] = [];
  const drawn = new Set<string>();
  nodes.forEach((node) => {
    const track = known.get(node.code) as CellTrackProperties;
    (track.parent_codes ?? []).forEach((parent) => {
      if (!inGraph.has(parent)) return;
      const key = `${parent}->${node.code}`;
      if (drawn.has(key)) return;
      drawn.add(key);
      edges.push({ from: parent, to: node.code });
    });
  });

  return { nodes, edges };
}

/** What a node did to get here, for its label. */
export function nodeRole(lineage: Lineage, code: string): "split" | "merge" | "" {
  const parents = lineage.edges.filter((edge) => edge.to === code).length;
  const siblings = lineage.edges.filter((edge) => edge.from === code).length;
  if (parents > 1) return "merge";
  if (siblings > 1) return "split";
  return "";
}

/**
 * Where each moment sits on the family chart's time axis.
 *
 * The chart is laid out by `dagre`, which ranks nodes by depth in the graph
 * and knows nothing about when anything happened. That is fine for deciding
 * which node goes beside which -- and wrong for the vertical axis, because a
 * rank is not a time: in one real family the first rank held a cell from 16:10
 * and one from 15:35, so labelling ranks with clock times would have been
 * inventing a reading the layout could not support.
 *
 * So the rows are computed here from the timestamps and handed back to the
 * layout, and the axis labels the rows. Proportional to elapsed time, with a
 * floor: cells five minutes apart would otherwise be drawn closer together
 * than a node is tall, and the two 16:45 cells in that same family -- one the
 * parent of the other -- would land exactly on top of each other.
 *
 * Where the floor bites, the spacing understates the gap. That is visible
 * rather than hidden: every row carries its own clock label on the axis, so a
 * reader who cares about the exact interval reads it off rather than measuring
 * it, and the one thing the position always gets right is the order.
 *
 * `times` must be sorted ascending and distinct. Returns one offset per time,
 * in the same order, starting at zero.
 */
export function rowOffsets(times: number[], minGap: number, pxPerMs: number): number[] {
  const offsets: number[] = [];
  times.forEach((time, index) => {
    if (index === 0) {
      offsets.push(0);
      return;
    }
    const elapsed = (time - times[index - 1]) * pxPerMs;
    offsets.push(offsets[index - 1] + Math.max(minGap, elapsed));
  });
  return offsets;
}
