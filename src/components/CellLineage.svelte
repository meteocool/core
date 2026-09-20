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
 * Ranks still run in chronological order left to right, because every edge
 * goes from a parent to a child and so always points forwards in time; what is
 * lost is the spacing, where two ranks a minute apart and two an hour apart
 * look the same. Each node carries its own clock underneath to cover that.
 */
import dagre from "@dagrejs/dagre";
import { selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { buildLineage, nodeRole } from "../lib/cellLineage";
import type { CellTrackProperties } from "../api";

export let track: CellTrackProperties;
/** Every relative already loaded, by code; the panel does the fetching. */
export let known: Map<string, CellTrackProperties>;
/** True while relatives are still arriving, so a partial graph says so. */
export let loading = false;

const NODE_W = 62;
const NODE_H = 30;

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

interface Laid {
  width: number;
  height: number;
  nodes: Placed[];
  edges: string[];
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
    rankdir: "LR", nodesep: 12, ranksep: 30, marginx: 4, marginy: 4,
  });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => g.setNode(node.code, { width: NODE_W, height: NODE_H }));
  graph.edges.forEach((edge) => g.setEdge(edge.from, edge.to));
  dagre.layout(g);

  const nodes: Placed[] = graph.nodes.map((node) => {
    const placed = g.node(node.code);
    return {
      code: node.code,
      x: placed.x,
      y: placed.y,
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

  // dagre hands back the points it routed each edge through; a curve through
  // them keeps a merge from arriving as three lines on top of each other.
  const edges = graph.edges.map((edge) => {
    const points = g.edge(edge.from, edge.to)?.points ?? [];
    if (points.length < 2) return "";
    const [head, ...rest] = points;
    return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
  }).filter(Boolean);

  const { width, height } = g.graph();
  return { width: width ?? 0, height: height ?? 0, nodes, edges };
}

$: laid = layout(lineage);

/** Walking the family: the tapped relative becomes the open cell. */
function go(code: string) {
  const next = known.get(code);
  if (next && code !== track.code) selectedCell.set(next);
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
  .scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }
  svg {
    display: block;
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
  .peak {
    font: 500 9px/1 var(--mc-font, sans-serif);
    fill: var(--sl-color-neutral-500, #78716c);
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
  <figure>
    <figcaption>
      family &middot; tap to follow{#if loading} &middot; <span class="loading">loading…</span>{/if}
    </figcaption>
    <div class="scroll">
      <svg width={laid.width} height={laid.height} viewBox="0 0 {laid.width} {laid.height}"
        role="group" aria-label="Storm lineage">
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
            <text class="at" x={node.x} y={node.y - (node.peak ? 1 : -3)}>{node.at}</text>
            {#if node.peak}
              <text class="peak" x={node.x} y={node.y + 10}>{node.peak}</text>
            {/if}
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
