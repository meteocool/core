<script lang="ts">
/**
 * Where a storm came from and what it became.
 *
 * A cell is not a stable thing. It splits, and two storms carry on under new
 * codes; three of them merge and the survivor keeps one. Everything else in
 * this panel describes the cell as it is now, and none of it can say that the
 * 67 dBZ core you are reading was one of three that ran together twenty
 * minutes ago -- which is often the thing that explains it.
 *
 * Drawn only when there is something to draw. Two thirds of tracks in a real
 * run have no relatives at all; it is the severe ones that have families, 72%
 * of the strong cells against 8% of the weak.
 *
 * ## Layout
 *
 * `dagre` places the nodes. It lays out by graph structure rather than by
 * time, so unlike the two charts above this one it does not share their clock
 * -- a node's position says where it sits in the family, not when it was.
 * Ranks still run in chronological order, because every edge goes from a
 * parent to a child and so always points forwards in time; what is lost is the
 * spacing, where two ranks a minute apart and two an hour apart look the same.
 * Each node carries its own clock underneath to cover that.
 *
 * Top to bottom, which is the direction the panel already scrolls. Left to
 * right, a family grows along the one axis a phone has none of: five
 * generations is 450px of graph in a 350px sheet, so it either scrolls
 * sideways -- a gesture that fights the sheet's own vertical scroll and the
 * map pan behind it -- or it is squeezed. Downwards it grows into the
 * direction the reader is already moving, and the width is set by the widest
 * rank instead, which is the number of cells that merged at once: three in the
 * largest case seen, well inside the panel.
 */
import { tick } from "svelte";
import dagre from "@dagrejs/dagre";
import { selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { buildLineage, nodeRole, rowOffsets } from "../lib/cellLineage";
import type { CellTrackProperties } from "../api";

export let track: CellTrackProperties;
/** Every relative already loaded, by code; the panel does the fetching. */
export let known: Map<string, CellTrackProperties>;
/** True while relatives are still arriving, so a partial graph says so. */
export let loading = false;

const NODE_W = 62;
const NODE_H = 30;

/** The gutter the time axis and its labels live in. */
const AXIS_W = 40;

/** Closest two rows may be drawn, so nodes never overlap; see `rowOffsets`. */
const ROW_MIN = NODE_H + 14;

/**
 * How much height a minute of elapsed time buys.
 *
 * Set against the floor rather than in the abstract. `ROW_MIN` cannot go below
 * a node's own height, so any gap shorter than `ROW_MIN / PX_PER_MINUTE` is
 * drawn at the floor and reads as "the next step" -- at three pixels a minute
 * that is anything under about fifteen, which at DWD's five-minute cadence is
 * two or three runs, and "the next step" is what those are.
 *
 * Above that it is proportional and the distinction worth having survives: a
 * cell that split off a quarter of an hour ago sits close, one that split off
 * an hour ago sits four times further away. The first version used 1.1 and
 * every gap in a real family landed on the floor, which made the axis correct
 * and the spacing meaningless.
 */
const PX_PER_MINUTE = 3;

$: lineage = buildLineage(known, track.code);

/** 24-hour, as everything else in this panel is. */
const clock = (iso: string): string => new Date(iso)
  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

interface Placed {
  code: string;
  x: number;
  y: number;
  severity: number;
  self: boolean;
  badge: string;
  at: string;
  peak: string;
  /** Built here rather than in the markup, where the quoting gets away. */
  label: string;
}

interface Row {
  y: number;
  label: string;
}

interface Laid {
  width: number;
  height: number;
  nodes: Placed[];
  edges: string[];
  /** One per distinct detection time, which is what the axis labels. */
  rows: Row[];
}

/**
 * One layout pass, redone whenever the family changes.
 *
 * dagre mutates the graph it is given, so the graph is built fresh each time
 * rather than kept and updated -- these are a handful of nodes and the cost of
 * a rebuild is nothing next to the cost of a stale one.
 */
function layout(graph: ReturnType<typeof buildLineage>): Laid | null {
  if (graph.nodes.length < 2) return null;
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB", nodesep: 10, ranksep: 26, marginx: 4, marginy: 4,
  });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => g.setNode(node.code, { width: NODE_W, height: NODE_H }));
  graph.edges.forEach((edge) => g.setEdge(edge.from, edge.to));
  dagre.layout(g);

  /*
   * dagre decides which node goes beside which; the clock decides how far down.
   *
   * Its ranks are graph depth, not time -- a rank can hold a cell from 16:10
   * beside one from 15:35 -- so only the horizontal half of its answer is
   * kept. The vertical half comes from `rowOffsets`, which is what lets the
   * axis be a real time axis rather than a list of rank numbers with clocks
   * written against them.
   */
  const stamps = [...new Set(graph.nodes.map((node) => new Date(node.firstSeen).getTime()))]
    .sort((a, b) => a - b);
  const offsets = rowOffsets(stamps, ROW_MIN, PX_PER_MINUTE / 60_000);
  const rowOf = new Map(stamps.map((stamp, index) => [stamp, offsets[index] + NODE_H / 2 + 4]));

  const nodes: Placed[] = graph.nodes.map((node) => {
    const placed = g.node(node.code);
    return {
      code: node.code,
      x: placed.x + AXIS_W,
      y: rowOf.get(new Date(node.firstSeen).getTime()) as number,
      severity: node.severity,
      self: node.self,
      badge: node.meso ? "↻" : (node.hail ? "✦" : ""),
      at: clock(node.firstSeen),
      // The peak, not the role. Which node is a merge is already on the chart
      // -- three lines arrive at it -- and the time alone left two nodes
      // reading "16:45" with nothing to tell them apart. This is also what a
      // reader is scanning the family for: which of these was the big one.
      peak: node.peakDbz === null ? "" : `${Math.round(node.peakDbz)} dBZ`,
      label: `${nodeRole(graph, node.code) || "cell"}, first seen ${clock(node.firstSeen)}`
        + (node.peakDbz === null ? "" : `, peak ${Math.round(node.peakDbz)} dBZ`),
    };
  });

  /*
   * Drawn between the nodes rather than along dagre's routes, which were
   * computed for its own vertical positions and no longer land anywhere near
   * the ones above. A cubic with vertical handles keeps a merge arriving as
   * three separable curves rather than three lines crossing at a point.
   */
  const at = new Map(nodes.map((node) => [node.code, node]));
  const edges = graph.edges.flatMap((edge) => {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) return [];
    const y0 = from.y + NODE_H / 2;
    const y1 = to.y - NODE_H / 2;
    const bend = Math.max(8, (y1 - y0) / 2);
    return [`M ${from.x} ${y0} C ${from.x} ${y0 + bend}, ${to.x} ${y1 - bend}, ${to.x} ${y1}`];
  });

  const rows: Row[] = stamps.map((stamp) => ({
    y: rowOf.get(stamp) as number,
    label: clock(new Date(stamp).toISOString()),
  }));

  const width = (g.graph().width ?? 0) + AXIS_W;
  const height = offsets[offsets.length - 1] + NODE_H + 10;
  return { width, height, nodes, edges, rows };
}

$: laid = layout(lineage);

let figure: HTMLElement;

/**
 * Walking the family: the tapped relative becomes the open cell.
 *
 * The chart is scrolled back into view afterwards. Everything above it in the
 * panel is rebuilt for the new cell -- a different 3D model, different charts,
 * a different number of signal tags -- and the panel's own height changes with
 * it, so a reader who had scrolled down to the family found it had moved out
 * from under the finger that just tapped it. The graph stays put now, which
 * for a thing you navigate by is the whole point.
 */
function go(code: string) {
  const next = known.get(code);
  if (!next || code === track.code) return;
  selectedCell.set(next);
  // After the panel above has been rebuilt, or this scrolls to where the chart
  // was rather than where it has ended up.
  tick().then(() => figure?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}

function activate(event: KeyboardEvent, code: string) {
  if (event.key === "Enter" || event.key === " ") go(code);
}
</script>

<style>
  figure {
    margin: 10px 0 0;
  }
  figcaption {
    font-size: 11px;
    opacity: 0.6;
    margin-bottom: 2px;
  }
  /* Behind everything: a rule is a reading aid, not a mark, and a node that
     lands on one has to stay the thing being read. */
  .rule {
    stroke: currentColor;
    stroke-opacity: 0.1;
    stroke-width: 1;
  }
  .axis {
    stroke: currentColor;
    stroke-opacity: 0.25;
    stroke-width: 1;
  }
  .rowtime {
    font: 500 9px/1 var(--mc-font, sans-serif);
    fill: currentColor;
    fill-opacity: 0.55;
    text-anchor: end;
  }
  /* No sideways scrollbar, ever: the graph is laid out downwards, and where a
     rank is wider than the panel the SVG scales to fit. Only downwards --
     capped at its own width by the inline style, because a graph two nodes
     wide stretched across the panel renders 60px boxes at 180px and reads as
     a different component. */
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  /* The lines are the chart. A merge is three of them arriving at one node
     and a split is two leaving, which is the only place that reads -- so they
     are drawn to be followed rather than to stay out of the way. */
  .edge {
    fill: none;
    stroke: var(--sl-color-neutral-500, #78716c);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.85;
  }
  .node {
    cursor: pointer;
  }

  /* The clicked node keeps the browser's focus ring, which on a chart where
     one node is already outlined to say "you are here" reads as a second,
     contradictory highlight -- and lands on every hop. Dropped for the
     pointer, kept for the keyboard, which is the one case it is for. */
  .node:focus {
    outline: none;
  }
  .node:focus-visible .box {
    stroke-dasharray: 3 2;
  }
  .node.self {
    cursor: default;
  }
  .box {
    fill: var(--sl-color-neutral-0, #fff);
    stroke-width: 1.5;
  }
  /* Filled as well as thickened: on a chart where every node is an outlined
     box in a severity colour, a thicker outline alone is not "you are here". */
  .node.self .box {
    stroke-width: 2.5;
    fill: var(--sl-color-neutral-100, #f5f5f4);
  }
  .at {
    font: 600 10px/1 var(--mc-font, sans-serif);
    fill: var(--sl-color-neutral-900, #111);
    text-anchor: middle;
  }
  .badge {
    font: 700 10px/1 sans-serif;
    text-anchor: middle;
  }
  .loading {
    font-size: 11px;
    opacity: 0.6;
  }
</style>

{#if laid}
  <figure bind:this={figure}>
    <figcaption>
      family &middot; tap to follow{#if loading} &middot; <span class="loading">loading…</span>{/if}
    </figcaption>
    <div>
      <svg viewBox="0 0 {laid.width} {laid.height}" preserveAspectRatio="xMidYMin meet"
        style="max-width: {laid.width}px"
        role="group" aria-label="Storm lineage">
        <!-- The clock, and a rule across the chart at every moment a cell in
             this family was first detected. Before this the rows were dagre's
             ranks, which are depth in the graph rather than time: one of them
             held cells from 16:05, 16:20 and 16:45 side by side. -->
        {#each laid.rows as row (row.y)}
          <line class="rule" x1={AXIS_W - 4} x2={laid.width} y1={row.y} y2={row.y} />
          <text class="rowtime" x={AXIS_W - 8} y={row.y + 3}>{row.label}</text>
        {/each}
        <line class="axis" x1={AXIS_W - 4} x2={AXIS_W - 4} y1={laid.rows[0].y} y2={laid.rows[laid.rows.length - 1].y} />

        {#each laid.edges as d, i (i)}
          <path class="edge" {d} />
        {/each}
        {#each laid.nodes as node (node.code)}
          <g class="node" class:self={node.self}
            role="button" tabindex={node.self ? -1 : 0}
            aria-label={node.label}
            aria-current={node.self ? "true" : undefined}
            on:click={() => go(node.code)}
            on:keydown={(event) => activate(event, node.code)}>
            <rect class="box"
              x={node.x - NODE_W / 2} y={node.y - NODE_H / 2}
              width={NODE_W} height={NODE_H} rx="7"
              style="stroke: {severityColour(node.severity)}" />
            <!-- No clock on the node any more: the row it sits on says when,
                 and repeating it in every box was the only thing the chart had
                 before there was an axis to put it on. -->
            <text class="at" x={node.x} y={node.y + 4}>{node.peak || node.at}</text>
            {#if node.badge}
              <text class="badge" x={node.x + NODE_W / 2 - 7} y={node.y - NODE_H / 2 + 10}
                style="fill: {severityColour(node.severity)}">{node.badge}</text>
            {/if}
          </g>
        {/each}
      </svg>
    </div>
  </figure>
{/if}
