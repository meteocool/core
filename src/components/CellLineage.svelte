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
 * Left to right, and it scrolls sideways.
 *
 * Downwards was tried first, on the reasoning that a phone scrolls that way
 * anyway and a sideways scrollbar is a gesture that fights the sheet's own.
 * That is true and it cost more than it saved: a family is deeper in
 * generations than it is wide in concurrent cells, so laid out downwards it is
 * tall -- and every pixel it is tall is a pixel of map the sheet has to take
 * to show it. Sideways the height is set by the widest rank instead, which is
 * the number of cells that merged at once: three in the largest case seen. The
 * graph is short, the map keeps its half of the screen, and the length goes
 * into an axis the reader can push along.
 *
 * Which suits the axis too. Time runs left to right in the two charts above
 * this one and in every other chart in the panel; running it downwards here
 * made this the only one that did not.
 */
import { onDestroy, tick } from "svelte";
import dagre from "@dagrejs/dagre";
import { selectedCell } from "../stores";
import { severityColour } from "../layers/cells";
import { axisOffsets, buildLineage, nodeRole } from "../lib/cellLineage";
import type { CellTrackProperties } from "../api";

export let track: CellTrackProperties;
/** Every relative already loaded, by code; the panel does the fetching. */
export let known: Map<string, CellTrackProperties>;
/** True while relatives are still arriving, so a partial graph says so. */
export let loading = false;
/**
 * The present, for the `now` rule. Passed in rather than read here so it
 * follows the panel's own quarter-minute clock instead of starting a second
 * timer for a line that moves five pixels a minute.
 */
export let now: number = Date.now();

const NODE_W = 62;
const NODE_H = 30;

/** The strip along the bottom the time axis and its labels live in. */
const AXIS_H = 18;

/** Closest two moments may be drawn, so nodes never overlap; see `axisOffsets`. */
const COL_MIN = NODE_W + 12;

/**
 * How much width a minute of elapsed time buys.
 *
 * Set against the floor rather than in the abstract. `COL_MIN` cannot go below
 * a node's own width, so any gap shorter than `COL_MIN / PX_PER_MINUTE` is
 * drawn at the floor and reads as "the next step" -- at five pixels a minute
 * that is anything under about fifteen, which at DWD's five-minute cadence is
 * two or three runs, and "the next step" is what those are.
 *
 * Above that it is proportional and the distinction worth having survives: a
 * cell that split off a quarter of an hour ago sits close, one that split off
 * an hour ago sits four times further away.
 */
const PX_PER_MINUTE = 5;

/**
 * How far past the last detection the `now` rule may sit.
 *
 * The two charts above carry their axis to the present for a good reason -- a
 * trace that stops at the right-hand edge quietly implies the record is
 * current -- and this one should say the same thing. But those have a fixed
 * width and this one is as long as it needs to be, so an un-capped gap would
 * mean a family last seen two hours ago dragging six hundred pixels of empty
 * chart behind it. Past the cap the rule stops moving and the gap is
 * understated; the axis clocks underneath still say when the last one was.
 */
const NOW_MAX_PX = 110;

/** Width of the hint that there is more chart off either edge. */
const FADE_PX = 22;

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

interface Mark {
  x: number;
  label: string;
}

interface Laid {
  width: number;
  height: number;
  nodes: Placed[];
  edges: string[];
  /** One per distinct detection time, which is what the axis labels. */
  marks: Mark[];
  /** Where the present falls, or null when it is not past the last node. */
  nowX: number | null;
}

/**
 * One layout pass, redone whenever the family changes.
 *
 * dagre mutates the graph it is given, so the graph is built fresh each time
 * rather than kept and updated -- these are a handful of nodes and the cost of
 * a rebuild is nothing next to the cost of a stale one.
 */
function layout(graph: ReturnType<typeof buildLineage>, nowMs: number): Laid | null {
  if (graph.nodes.length < 2) return null;
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR", nodesep: 10, ranksep: 26, marginx: 4, marginy: 4,
  });
  g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => g.setNode(node.code, { width: NODE_W, height: NODE_H }));
  graph.edges.forEach((edge) => g.setEdge(edge.from, edge.to));
  dagre.layout(g);

  /*
   * dagre decides which lane a node goes in; the clock decides how far along.
   *
   * Its ranks are graph depth, not time -- a rank can hold a cell from 16:10
   * beside one from 15:35 -- so only the vertical half of its answer is kept.
   * The horizontal half comes from `axisOffsets`, which is what lets the axis
   * be a real time axis rather than a list of rank numbers with clocks written
   * against them.
   */
  const stamps = [...new Set(graph.nodes.map((node) => new Date(node.firstSeen).getTime()))]
    .sort((a, b) => a - b);
  const offsets = axisOffsets(stamps, COL_MIN, PX_PER_MINUTE / 60_000);
  const colOf = new Map(stamps.map((stamp, index) => [stamp, offsets[index] + NODE_W / 2 + 4]));

  const nodes: Placed[] = graph.nodes.map((node) => {
    const placed = g.node(node.code);
    return {
      code: node.code,
      x: colOf.get(new Date(node.firstSeen).getTime()) as number,
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

  /*
   * Drawn between the nodes rather than along dagre's routes, which were
   * computed for its own horizontal positions and no longer land anywhere near
   * the ones above. A cubic with horizontal handles keeps a merge arriving as
   * three separable curves rather than three lines crossing at a point.
   */
  const at = new Map(nodes.map((node) => [node.code, node]));
  const edges = graph.edges.flatMap((edge) => {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) return [];
    const x0 = from.x + NODE_W / 2;
    const x1 = to.x - NODE_W / 2;
    const bend = Math.max(8, (x1 - x0) / 2);
    return [`M ${x0} ${from.y} C ${x0 + bend} ${from.y}, ${x1 - bend} ${to.y}, ${x1} ${to.y}`];
  });

  const height = (g.graph().height ?? 0) + AXIS_H;
  const marks: Mark[] = stamps.map((stamp) => ({
    x: colOf.get(stamp) as number,
    label: clock(new Date(stamp).toISOString()),
  }));

  /*
   * The present, on the same axis the nodes sit on. Measured from the last
   * detection rather than laid out as another stamp, because it is not a
   * column: nothing is drawn in it and nothing needs clearing.
   */
  const lastStamp = stamps[stamps.length - 1];
  const lastX = colOf.get(lastStamp) as number;
  const elapsed = Math.max(0, nowMs - lastStamp) * (PX_PER_MINUTE / 60_000);
  const nowX = elapsed > 1 ? lastX + Math.min(elapsed, NOW_MAX_PX) : null;

  const width = Math.max(
    offsets[offsets.length - 1] + NODE_W + 8,
    nowX === null ? 0 : nowX + 12,
  );
  return {
    width, height, nodes, edges, marks, nowX,
  };
}

$: laid = layout(lineage, now);

let figure: HTMLElement;
let scroller: HTMLElement;

/**
 * How much of the fade at each edge is showing.
 *
 * The chart scrolls sideways inside a panel that is otherwise a vertical
 * stack, and a horizontal scrollbar is a poor way to say so: on a trackpad and
 * on a phone it is not drawn at all until the moment it is already being used,
 * which is after the reader has had to guess. Fading the content out towards
 * whichever side has more says it without a control -- the graph visibly runs
 * under the edge -- and it says it continuously, shrinking to nothing as the
 * end is reached. The bar itself is hidden, so the fade is the only signal
 * rather than a second one.
 */
let fadeStart = 0;
let fadeEnd = 0;

function updateFade() {
  if (!scroller) return;
  const slack = scroller.scrollWidth - scroller.clientWidth;
  if (slack <= 1) {
    fadeStart = 0;
    fadeEnd = 0;
    return;
  }
  // Clamped to the slack on each side, so the fade eases away over the last
  // few pixels instead of vanishing the instant the end is hit.
  fadeStart = Math.max(0, Math.min(scroller.scrollLeft, FADE_PX));
  fadeEnd = Math.max(0, Math.min(slack - scroller.scrollLeft, FADE_PX));
}

/*
 * The panel is resizable (a desktop window, a phone rotating, the sheet being
 * dragged), and whether the chart overflows at all can change with it.
 */
let observer: ResizeObserver | null = null;
$: if (scroller && !observer && typeof ResizeObserver !== "undefined") {
  observer = new ResizeObserver(() => updateFade());
  observer.observe(scroller);
}
onDestroy(() => observer?.disconnect());

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
  tick().then(() => {
    figure?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    showNode(code);
  });
}

/**
 * Bring a node into the chart's own sideways scroll.
 *
 * The chart is wider than the panel, and the node just tapped is usually the
 * reason to scroll: walking towards the end of a family means each tap lands
 * further right, so without this the newly selected cell is off the edge and
 * the highlight moves somewhere the reader cannot see -- which was measurable,
 * a selected node at x 852 in a 351-wide window still scrolled to 0.
 *
 * Centred, because that also brings its parents and children into view, and
 * they are what the next tap needs. Nothing happens when the chart already
 * fits, which is most families.
 */
function showNode(code: string) {
  const at = laid?.nodes.find((placed) => placed.code === code);
  if (!at || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  // The SVG is drawn at its own width, so a node's x is already in scroll
  // pixels and there is no scale factor to apply.
  const target = at.x - scroller.clientWidth / 2;
  scroller.scrollTo({
    left: Math.max(0, Math.min(target, scroller.scrollWidth - scroller.clientWidth)),
    behavior: "smooth",
  });
}

/*
 * Also when the cell was opened from the map or the hint bar rather than from
 * the chart: the chart is drawn scrolled to its start, and the open cell can
 * be anywhere along it.
 *
 * The scroll is keyed on the code, not on `laid`. The layout is rebuilt every
 * time the clock ticks, because the "now" mark moves with it, and re-centring
 * on each of those took the chart back from wherever the reader had scrolled
 * it every fifteen seconds -- a graph you navigate by that will not stay where
 * it is put. The fade still follows every relayout, because the widths do.
 */
let centred: string | null = null;
$: if (laid && track) {
  const code = track.code;
  const moved = code !== centred;
  centred = code;
  tick().then(() => {
    if (moved) showNode(code);
    updateFade();
  });
}

function activate(event: KeyboardEvent, code: string) {
  if (event.key === "Enter" || event.key === " ") go(code);
}
</script>

<style>
  figure {
    margin: 10px 0 0;
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
  /* The present, dashed and light, exactly as the two charts above draw it --
     it is the same claim about the same clock, and drawing it differently here
     would make a reader work out twice that it is not a measurement. */
  .nowline {
    stroke: currentColor;
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .nowlabel {
    font-size: 8px;
    fill: currentColor;
    fill-opacity: 0.55;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-anchor: end;
  }
  .axistime {
    font: 500 9px/1 var(--mc-font, sans-serif);
    fill: currentColor;
    fill-opacity: 0.55;
    text-anchor: middle;
  }
  /* The length runs sideways and is pushed along rather than scaled down: at
     the sizes a family reaches, fitting it to the panel would put 62px nodes
     at twenty. `contain` keeps the gesture inside the chart, so a push here
     does not also drag the sheet or pan the map behind it. */
  .scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    /* The bar is hidden so the fade is the only thing saying "there is more",
       rather than a second, uglier one. Firefox and WebKit spell it
       differently and neither understands the other. */
    scrollbar-width: none;
    /* Masked rather than overlaid with a gradient: the panel behind this is a
       different colour in each scheme and on the sheet it is translucent over
       the map, so anything painted on top would have to guess what it is
       covering. A mask fades the chart into whatever is actually there. */
    -webkit-mask-image: var(--lineage-fade);
    mask-image: var(--lineage-fade);
    transition: -webkit-mask-image var(--mc-motion-fast, 120ms) linear,
                mask-image var(--mc-motion-fast, 120ms) linear;
  }
  .scroll::-webkit-scrollbar {
    display: none;
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
  .badge {
    font: 700 10px/1 sans-serif;
    text-anchor: middle;
  }
</style>

{#if laid}
  <figure bind:this={figure}>
    <figcaption class="section">
      Family<span class="aside">tap to follow{#if loading} &middot; loading…{/if}</span>
    </figcaption>
    <div
      class="scroll"
      bind:this={scroller}
      on:scroll={updateFade}
      style="--lineage-fade: linear-gradient(to right,
        transparent 0, #000 {fadeStart}px,
        #000 calc(100% - {fadeEnd}px), transparent 100%)"
    >
      <svg width={laid.width} height={laid.height} viewBox="0 0 {laid.width} {laid.height}"
        role="group" aria-label="Storm lineage">
        <!-- The clock, and a rule down the chart at every moment a cell in
             this family was first detected. Before this the columns were
             dagre's ranks, which are depth in the graph rather than time: one
             of them held cells from 16:05, 16:20 and 16:45 together. -->
        {#each laid.marks as mark (mark.x)}
          <line class="rule" x1={mark.x} x2={mark.x} y1="0" y2={laid.height - AXIS_H} />
          <text class="axistime" x={mark.x} y={laid.height - 4}>{mark.label}</text>
        {/each}
        <line class="axis" y1={laid.height - AXIS_H} y2={laid.height - AXIS_H}
              x1={laid.marks[0].x} x2={laid.marks[laid.marks.length - 1].x} />

        <!-- Behind the edges and nodes, with the rules: a reference, not a
             mark. Labelled to its left because it sits at the right-hand end
             of the chart, where a label to its right would be off the edge. -->
        {#if laid.nowX !== null}
          <line class="nowline" x1={laid.nowX} x2={laid.nowX} y1="0" y2={laid.height - AXIS_H} />
          <text class="nowlabel" x={laid.nowX - 3} y="8">now</text>
        {/if}

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
