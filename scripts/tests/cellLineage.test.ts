import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLineage, MAX_FAMILY, missingRelatives, nodeRole, reachable, axisOffsets,
} from "../../src/lib/cellLineage.ts";

/**
 * The family graph behind the lineage chart.
 *
 * Shaped on a real run: one cell split into two, three cells merged into one,
 * and a seven-node family that did both across three generations. The awkward
 * parts are all bookkeeping -- an edge is named by both of its endpoints, a
 * relative may not have been fetched yet, and the identifier the graph is
 * built from is documented as being reused across unrelated cells.
 */

let clock = 0;
const cell = (code: string, parents: string[] = [], children: string[] = []) => {
  clock += 1;
  return [code, {
    code,
    parent_codes: parents,
    child_codes: children,
    max_severity: 1,
    first_seen: `2026-09-20T10:${String(clock).padStart(2, "0")}:00Z`,
    last_seen: "2026-09-20T11:00:00Z",
    max_dbz: 55,
    hail_ever: false,
    meso_ever: false,
  }] as const;
};

const known = (...entries: ReturnType<typeof cell>[]) =>
  new Map(entries.map(([code, track]) => [code, track])) as never;

test("a cell with no relatives has no graph to draw", () => {
  // Two thirds of tracks in a real run: the caller draws nothing for these.
  const map = known(cell("solo"));
  assert.deepEqual(buildLineage(map, "solo"), { nodes: [], edges: [] });
});

test("a split is one parent and two children", () => {
  const map = known(
    cell("p", [], ["a", "b"]),
    cell("a", ["p"]),
    cell("b", ["p"]),
  );
  const lineage = buildLineage(map, "a");
  assert.deepEqual(lineage.nodes.map((n) => n.code).sort(), ["a", "b", "p"]);
  assert.deepEqual(lineage.edges.sort((x, y) => x.to.localeCompare(y.to)),
    [{ from: "p", to: "a" }, { from: "p", to: "b" }]);
  assert.equal(nodeRole(lineage, "p"), "split");
});

test("a merge is several parents into one child", () => {
  const map = known(
    cell("x", [], ["m"]),
    cell("y", [], ["m"]),
    cell("z", [], ["m"]),
    cell("m", ["x", "y", "z"]),
  );
  const lineage = buildLineage(map, "m");
  assert.equal(lineage.edges.length, 3);
  assert.equal(nodeRole(lineage, "m"), "merge");
});

test("an edge named by both of its endpoints is drawn once", () => {
  // Both sides carry the relationship; taking it from both doubles every line.
  const map = known(cell("p", [], ["c"]), cell("c", ["p"]));
  assert.deepEqual(buildLineage(map, "c").edges, [{ from: "p", to: "c" }]);
});

test("edges run the way time does, whichever end you start from", () => {
  const map = known(cell("p", [], ["c"]), cell("c", ["p"]));
  assert.deepEqual(buildLineage(map, "p").edges, buildLineage(map, "c").edges);
});

test("the walk reaches a whole family, not just one hop", () => {
  const map = known(
    cell("g", [], ["p"]),
    cell("p", ["g"], ["c"]),
    cell("c", ["p"]),
  );
  assert.deepEqual(reachable(map, "c").sort(), ["c", "g", "p"]);
});

test("a relative that has not been fetched is not a node", () => {
  // A family can reach outside the viewport the tracks were fetched for, so a
  // half-loaded graph has to stay drawable rather than referencing a ghost.
  const map = known(cell("c", ["elsewhere"]));
  assert.deepEqual(buildLineage(map, "c"), { nodes: [], edges: [] });
  assert.deepEqual(missingRelatives(map, "c"), ["elsewhere"]);
});

test("nothing is asked for twice, or asked for once it is held", () => {
  const map = known(cell("a", [], ["b", "gone"]), cell("b", ["a"], ["gone"]));
  assert.deepEqual(missingRelatives(map, "a"), ["gone"]);
});

test("the walk is bounded, whatever the feed sends", () => {
  // The identity upstream is DWD's cell number, which the schema says is
  // reused across unrelated cells; a chart is not where that should surprise us.
  const entries = [];
  for (let i = 0; i < 100; i += 1) {
    entries.push(cell(`n${i}`, i ? [`n${i - 1}`] : [], [`n${i + 1}`]));
  }
  const map = known(...entries);
  assert.equal(reachable(map, "n0").length, MAX_FAMILY);
});

test("a cycle terminates rather than walking forever", () => {
  const map = known(cell("a", ["b"], ["b"]), cell("b", ["a"], ["a"]));
  assert.deepEqual(reachable(map, "a").sort(), ["a", "b"]);
});

test("nodes come out oldest first", () => {
  const map = known(cell("first", [], ["second"]), cell("second", ["first"]));
  assert.deepEqual(buildLineage(map, "second").nodes.map((n) => n.code), ["first", "second"]);
});

/**
 * The chart is something you click around in, so the graph has to be a
 * property of the family rather than of the node you happen to be standing on.
 * Walk to a relative and the nodes must come back in the same order, so the
 * layout puts them in the same places and the next one you wanted is still
 * under the cursor.
 */
test("the same family comes out identical from whichever node you enter it", () => {
  const map = known(
    cell("gp", [], ["a"]),
    cell("a", ["gp"], ["m"]),
    cell("b", [], ["m"]),
    cell("m", ["a", "b"], ["x", "y"]),
    cell("x", ["m"]),
    cell("y", ["m"]),
  );
  const fromRoot = buildLineage(map, "gp");
  ["a", "b", "m", "x", "y"].forEach((code) => {
    const other = buildLineage(map, code);
    assert.deepEqual(other.nodes.map((n) => n.code), fromRoot.nodes.map((n) => n.code));
    assert.deepEqual(other.edges, fromRoot.edges);
  });
});

test("cells that start in the same minute keep a stable order", () => {
  // Two nodes both reading 16:45 turned up in the run this was built against.
  // On the timestamp alone they came back in traversal order, so walking the
  // family swapped them under a cursor that had not moved.
  const same = (code: string, parents: string[], children: string[] = []) => [code, {
    code,
    parent_codes: parents,
    child_codes: children,
    max_severity: 1,
    first_seen: "2026-09-20T16:45:00Z",
    last_seen: "2026-09-20T17:00:00Z",
    max_dbz: 60,
    hail_ever: false,
    meso_ever: false,
  }] as never;
  const map = new Map([
    same("p", [], ["twinB", "twinA"]),
    same("twinA", ["p"]),
    same("twinB", ["p"]),
  ]) as never;
  const order = (root: string) => buildLineage(map, root).nodes.map((n) => n.code);
  assert.deepEqual(order("twinA"), order("twinB"));
  assert.deepEqual(order("twinA"), order("p"));
});

/**
 * The family chart's time axis.
 *
 * dagre ranks by depth in the graph, not by time -- in one real family the
 * first rank held a cell from 16:10 and one from 15:35 -- so the positions
 * along the clock have to come from the timestamps, or the axis labels a
 * reading the layout cannot support.
 */
const MINUTE = 60_000;

test("a single moment sits at the start", () => {
  assert.deepEqual(axisOffsets([0], 40, 1), [0]);
  assert.deepEqual(axisOffsets([], 40, 1), []);
});

test("positions are spaced by how much time passed", () => {
  const at = axisOffsets([0, 10 * MINUTE, 20 * MINUTE], 10, 2 / MINUTE);
  assert.deepEqual(at, [0, 20, 40]);
});

test("a longer gap is drawn as a longer gap", () => {
  const at = axisOffsets([0, 10 * MINUTE, 40 * MINUTE], 10, 1 / MINUTE);
  assert.ok(at[2] - at[1] > at[1] - at[0]);
});

test("nodes never land on top of each other, however close in time", () => {
  // The two 16:45 cells in one real family were parent and child of each
  // other; five minutes apart at any sane scale is less than a node is wide.
  const at = axisOffsets([0, MINUTE, 2 * MINUTE], 40, 1 / MINUTE);
  assert.deepEqual(at, [0, 40, 80]);
});

test("positions only ever run forwards", () => {
  const at = axisOffsets([0, MINUTE, 90 * MINUTE, 91 * MINUTE], 36, 1.5 / MINUTE);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] > at[i - 1]);
});
