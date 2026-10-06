<script lang="ts">
/**
 * How the radar works: how the radars scan, when what they measured is
 * published, and which part of meteocool is made from which. Opened from the
 * "?" in the radar product picker's menu.
 *
 * The diagrams are drawn here from the geometry rather than shipped as
 * pictures, so they take the app's own palette, theme and language: the side
 * view's beams are the real beam heights for DWD's ten tilts, and the echoes
 * are coloured by the radar palette the settings name. The times were measured
 * on 5 October 2026 against a German radar cycle; see the "From Scan to Map"
 * write-up behind it.
 */
import { _, locale } from "svelte-i18n";
import GlassPanel from "./GlassPanel.svelte";
import { radarColormap } from "../stores";
import { dbzColour } from "../lib/cellVolume";

/* Tilts as the reader writes numbers: 0,5° in German. */
const num = (value: number, tag: string | null | undefined) => value.toLocaleString(tag ?? "en");

/* Echoes in the radar's own palette: light rain, heavy rain, hail. */
const rgb = (dbz: number, colormap: string) => `rgb(${dbzColour(dbz, colormap).join(",")})`;
$: echo = { low: rgb(22, $radarColormap), mid: rgb(42, $radarColormap), high: rgb(57, $radarColormap) };

/* ---------------------------------------------------------------- side view */

/** The height of a beam's centre above the ground, km: the 4/3 earth radius bends it as the air does. */
const EARTH_KM = (4 / 3) * 6371;
function beamHeight(rangeKm: number, tiltDeg: number): number {
  const t = (tiltDeg * Math.PI) / 180;
  return Math.sqrt(rangeKm ** 2 + EARTH_KM ** 2 + 2 * rangeKm * EARTH_KM * Math.sin(t)) - EARTH_KM;
}

const EL = { x0: 70, x1: 860, y0: 360, y1: 50, km: 180, top: 14 };
const ex = (km: number) => EL.x0 + ((EL.x1 - EL.x0) * km) / EL.km;
const ey = (h: number) => EL.y0 - ((EL.y0 - EL.y1) * h) / EL.top;

/** DWD's ten tilts and how far each reaches. */
const TILTS: Array<[number, number]> = [
  [0.5, 180], [1.5, 180], [2.5, 180], [3.5, 180], [4.5, 180], [5.5, 180], [8, 124], [12, 60], [17, 60], [25, 60],
];

function beamPoints(tilt: number, reach: number, offset = 0): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let r = 0; r <= reach; r += 1) points.push([ex(r), ey(beamHeight(r, tilt + offset))]);
  return points;
}
const asPoints = (points: Array<[number, number]>) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

const beams = TILTS.map(([tilt, reach]) => {
  const end = beamHeight(reach, tilt);
  let label: { x: number; y: number; anchor: string };
  if (end <= EL.top) {
    label = { x: ex(reach) + 6, y: ey(end) + 4, anchor: "start" };
  } else {
    let r = 0;
    while (beamHeight(r, tilt) < EL.top) r += 0.25;
    label = { x: ex(r), y: EL.y1 - 8, anchor: "middle" };
  }
  return { tilt, points: asPoints(beamPoints(tilt, reach)), label, dot: reach < 180 && end <= EL.top ? { x: ex(reach), y: ey(end) } : null };
});

/* The 0.5° beam's width, as the band between its edges. */
const wedge = asPoints([...beamPoints(0.5, 180, 0.5), ...beamPoints(0.5, 180, -0.5).reverse()]);

function stormPath(centre: number, width: number, top: number): string {
  const l = centre - width / 2;
  const r = centre + width / 2;
  return `M${ex(l)},${ey(0)} L${ex(l + 1)},${ey(top * 0.75)} Q${ex(centre - width * 0.15)},${ey(top * 1.03)} ${ex(centre)},${ey(top)} `
    + `Q${ex(centre + width * 0.35)},${ey(top * 1.02)} ${ex(r)},${ey(top * 0.82)} L${ex(r - 1)},${ey(0)} Z`;
}
const storm = [stormPath(86, 24, 11), stormPath(85, 13, 8.5), stormPath(84, 6, 6)];
const heightTicks = [0, 2, 4, 6, 8, 10, 12, 14];
const distanceTicks = [0, 30, 60, 90, 120, 150, 180];

/* ---------------------------------------------------------------- top view */

const AZ = { cx: 250, cy: 235, r: 205 };
const perKm = AZ.r / 180;
const polar = (deg: number, radius: number) => {
  const t = (deg * Math.PI) / 180;
  return [AZ.cx + radius * Math.sin(t), AZ.cy - radius * Math.cos(t)];
};
const spokes = Array.from({ length: 36 }, (_unused, i) => ({ end: polar(i * 10, AZ.r), major: i % 9 === 0 }));
const trail = [0.05, 0.08, 0.12, 0.18, 0.28].map((opacity, i) => {
  const [ax, ay] = polar(-30 + i * 6, AZ.r);
  const [bx, by] = polar(-24 + i * 6, AZ.r);
  return { opacity, d: `M${AZ.cx},${AZ.cy} L${ax.toFixed(1)},${ay.toFixed(1)} A${AZ.r},${AZ.r} 0 0 1 ${bx.toFixed(1)},${by.toFixed(1)} Z` };
});
const RAY_DEG = 40;
const ray = (() => {
  const [ax, ay] = polar(RAY_DEG - 0.5, AZ.r);
  const [bx, by] = polar(RAY_DEG + 0.5, AZ.r);
  return `M${AZ.cx},${AZ.cy} L${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} Z`;
})();
const [zoomX, zoomY] = polar(RAY_DEG, 120 * perKm);
/* Echo blobs at (east km, north km), with radii in km and a rotation. */
const blobs: Array<[number, number, number, number, number, "low" | "mid" | "high"]> = [
  [70, 55, 34, 16, -35, "low"], [74, 52, 16, 8, -35, "mid"], [77, 50, 6, 4, -35, "high"],
  [-95, -40, 40, 22, 20, "low"], [-92, -42, 18, 10, 20, "mid"], [30, -120, 28, 12, 60, "low"],
];
const BINS: Array<"low" | "mid" | "high" | "none"> = ["low", "low", "mid", "high", "mid", "low", "none", "none", "low", "none"];
const INSET = { x: 540, y: 120, w: 340, h: 120 };
const binWidth = (INSET.w - 28) / BINS.length;

/* ---------------------------------------------------------------- one cycle */

const TL = { left: 150, right: 950, minutes: 10 };
const tx = (minute: number) => TL.left + ((TL.right - TL.left) * minute) / TL.minutes;
type Block = { start: number; end: number; tilt: number | null; kind: "pcp" | "low" | "high"; next: boolean };
function cycle(start: number, next: boolean): Block[] {
  const blocks: Block[] = [{ start, end: start + 0.5, tilt: null, kind: "pcp", next }];
  let t = start + 0.5;
  for (const tilt of [5.5, 4.5, 3.5, 2.5, 1.5, 0.5]) {
    blocks.push({ start: t, end: t + 2.5 / 6, tilt, kind: "low", next });
    t += 2.5 / 6;
  }
  for (const tilt of [8, 12, 17, 25]) {
    blocks.push({ start: t, end: t + 0.5, tilt, kind: "high", next });
    t += 0.5;
  }
  return blocks;
}
const blocks = [...cycle(0, false), ...cycle(5, true)];
const minuteTicks = Array.from({ length: 11 }, (_unused, i) => i);

/* ---------------------------------------------------------------- what is made from which */

type NodeKind = "scan" | "file" | "ours";
const COL_X = [20, 390, 720];
const COL_W = [230, 220, 260];
const NODE_H = 44;
const NODES: Record<string, [number, number, NodeKind]> = {
  pcp: [0, 60, "scan"], vol: [0, 230, "scan"], nets: [0, 420, "scan"], bz: [0, 560, "scan"],
  hx: [1, 30, "file"], wn: [1, 90, "file"], hg: [1, 150, "file"], dmax: [1, 215, "file"], k3d: [1, 280, "file"],
  meso: [1, 340, "file"], sweeps: [1, 430, "file"], strk: [1, 560, "file"],
  m_de: [2, 30, "ours"], m_fc: [2, 90, "ours"], m_hg: [2, 150, "ours"], m_cell: [2, 230, "ours"], m_meso: [2, 300, "ours"],
  m_3d: [2, 370, "ours"], m_net: [2, 440, "ours"], m_eu: [2, 500, "ours"], m_colmax: [2, 560, "ours"],
  m_lt: [2, 620, "ours"],
};
/* The one box with nothing to add under its name. */
const NO_SUBTITLE = new Set(["m_meso"]);
const nodes = Object.entries(NODES).map(([id, [col, y, kind]]) => ({
  id, x: COL_X[col], y, w: COL_W[col], kind, subtitle: !NO_SUBTITLE.has(id),
}));
const EDGES: Array<[string, string]> = [
  ["pcp", "hx"], ["pcp", "wn"], ["pcp", "hg"], ["vol", "dmax"], ["vol", "k3d"], ["vol", "meso"], ["vol", "sweeps"],
  ["nets", "sweeps"], ["bz", "strk"], ["hx", "m_de"], ["wn", "m_fc"], ["hg", "m_hg"], ["k3d", "m_cell"], ["dmax", "m_cell"],
  ["meso", "m_meso"], ["dmax", "m_3d"], ["sweeps", "m_3d"], ["sweeps", "m_net"], ["sweeps", "m_eu"], ["sweeps", "m_colmax"],
  ["strk", "m_lt"],
];
const STRONG = new Set(["dmax>m_3d", "sweeps>m_3d"]);
const edges = EDGES.map(([a, b]) => {
  const [ca, ya] = NODES[a];
  const [cb, yb] = NODES[b];
  const x1 = COL_X[ca] + COL_W[ca];
  const y1 = ya + NODE_H / 2;
  const x2 = COL_X[cb];
  const y2 = yb + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return {
    strong: STRONG.has(`${a}>${b}`),
    d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 6},${y2}`,
    head: `M${x2 - 7},${y2 - 4} L${x2},${y2} L${x2 - 7},${y2 + 4}`,
  };
});

const TIMES = ["pcp_done", "hx", "frame", "wn", "sweep_low", "vol_done", "dmax", "sweep_last", "clouds", "next_frame"];
const OURS_TIMES = new Set(["frame", "clouds", "next_frame"]);
const PRODUCTS = ["de", "forecast", "types", "networks", "europe", "colmax", "cells", "clouds", "meso", "lightning"];
</script>

<style>
  .explainer {
    font: var(--mc-type-body);
    color: var(--mc-text);
  }
  .explainer :global(p) { margin: 0.7em 0 0; }
  .col { max-width: 40rem; }
  .lede { color: var(--mc-text-2); margin-top: 2px; }
  .note { color: var(--mc-text-2); font-size: 12.5px; margin-top: 0.6em; }

  h3 {
    font: var(--mc-type-heading);
    letter-spacing: -0.01em;
    margin: 28px 0 0;
  }

  figure { margin: 14px 0 0; }
  .fig {
    overflow-x: auto;
    border-radius: var(--mc-radius-inner);
    background: var(--mc-tint);
    padding: 8px;
  }
  .fig svg { display: block; width: 100%; min-width: 640px; height: auto; }
  figcaption { color: var(--mc-text-2); font-size: 12.5px; margin-top: 6px; max-width: 46rem; }

  .key { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 12.5px; color: var(--mc-text-2); }
  .key span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .sw.scan { background: var(--mc-accent-tint); border: 1px solid var(--mc-accent); }
  .sw.file { border: 1px solid var(--mc-text-2); }
  .sw.ours { border: 2px solid var(--mc-orange); }

  .table { overflow-x: auto; margin-top: 12px; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--mc-separator); }
  th { font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--mc-text-2); }
  td.t { white-space: nowrap; font-weight: 600; }
  tr.ours td:first-child { color: var(--mc-orange-ink); font-weight: 600; }

  /* diagram ink, from the app's tokens so both themes hold */
  svg text { font-family: var(--mc-font); }
  .grid { stroke: var(--mc-separator); stroke-width: 1; }
  .tick { fill: var(--mc-text-2); font-size: 13px; font-variant-numeric: tabular-nums; }
  .axis { fill: var(--mc-text-2); font-size: 14px; }
  .label { fill: var(--mc-text); font-size: 14px; }
  .small { fill: var(--mc-text-2); font-size: 12.5px; }
  .ink { fill: var(--mc-text); }
  .ground { stroke: var(--mc-text); stroke-width: 1.5; }
  .beam { fill: none; stroke: var(--mc-accent); stroke-width: 2; }
  .beamlabel { fill: var(--mc-accent); font-size: 13px; font-weight: 600; }
  .accentfill { fill: var(--mc-accent); }
  .wedge { fill: var(--mc-accent-tint); }
  .disc { fill: var(--mc-sheet); stroke: var(--mc-separator); }
  .ring { fill: none; stroke: var(--mc-text-2); stroke-width: 1; stroke-dasharray: 4 4; }
  .spoke { stroke: var(--mc-separator); stroke-width: 1; }
  .spoke.major { stroke: var(--mc-text-3); }
  .antenna { stroke: var(--mc-accent); stroke-width: 2.5; }
  .orange { fill: var(--mc-orange); }
  .zoomspot { fill: none; stroke: var(--mc-orange); stroke-width: 2; }
  .lead { stroke: var(--mc-orange); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .inset { fill: var(--mc-sheet); stroke: var(--mc-separator); }
  .empty { fill: var(--mc-sheet); stroke: var(--mc-separator); }
  .fact { fill: var(--mc-text); font-size: 18px; font-weight: 700; }
  .sweep { transform-box: view-box; animation: radar-help-spin 8s linear infinite; }
  @keyframes radar-help-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .sweep { animation: none; } }

  .rowname { fill: var(--mc-text); font-size: 15px; font-weight: 700; }
  .blk.pcp { fill: var(--mc-accent); }
  .blk.low, .blk.high { fill: var(--mc-accent-tint); stroke: var(--mc-accent); stroke-width: 1; }
  .blk.high { stroke-dasharray: 3 2; }
  .next { opacity: 0.45; }
  .blklabel { fill: var(--mc-text); font-size: 12px; font-weight: 600; }
  .mk { stroke: var(--mc-text-2); fill: var(--mc-text-2); stroke-width: 1.5; }
  .mk.ours { stroke: var(--mc-orange); fill: var(--mc-orange); }
  .mklabel { fill: var(--mc-text); font-size: 13.5px; font-weight: 600; }
  .match { fill: var(--mc-orange-tint); stroke: var(--mc-orange); stroke-opacity: 0.6; }
  .gap { stroke: var(--mc-text-2); stroke-width: 1; stroke-dasharray: 2 3; }

  .colhead { fill: var(--mc-text-2); font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .node { stroke-width: 1.5; fill: var(--mc-sheet); }
  .node.scan { fill: var(--mc-accent-tint); stroke: var(--mc-accent); }
  .node.file { stroke: var(--mc-text-2); }
  .node.ours { stroke: var(--mc-orange); stroke-width: 2; }
  .nodet { fill: var(--mc-text); font-size: 15px; font-weight: 700; }
  .nodes { fill: var(--mc-text-2); font-size: 12.5px; }
  .edge { fill: none; stroke: var(--mc-text-3); stroke-width: 1.4; }
  .edge.strong { stroke: var(--mc-orange); stroke-width: 2; }
</style>

<GlassPanel title={$_("radar_help.title")} wide on:close>
  <div class="explainer">
    <div class="col">
      <p class="lede">{$_("radar_help.lede")}</p>
      <p class="note">{$_("radar_help.measured")}</p>
    </div>

    <!-- One radar, one turn -->
    <div class="col">
      <h3>{$_("radar_help.turn.title")}</h3>
      <p>{$_("radar_help.turn.p1")}</p>
      <p>{$_("radar_help.turn.p2")}</p>
    </div>
    <figure>
      <div class="fig">
        <svg viewBox="0 0 900 470" role="img" aria-label={$_("radar_help.turn.caption")}>
          <defs><clipPath id="radar-help-disc"><circle cx={AZ.cx} cy={AZ.cy} r={AZ.r} /></clipPath></defs>
          <circle class="disc" cx={AZ.cx} cy={AZ.cy} r={AZ.r} />
          <g clip-path="url(#radar-help-disc)">
            {#each blobs as [east, north, rx, ry, rot, level], index (index)}
              <ellipse
                cx={AZ.cx + east * perKm} cy={AZ.cy - north * perKm} rx={rx * perKm} ry={ry * perKm}
                transform="rotate({rot} {AZ.cx + east * perKm} {AZ.cy - north * perKm})" fill={echo[level]} />
            {/each}
          </g>
          {#each [60, 120, 180] as km, index (index)}
            <circle class="ring" cx={AZ.cx} cy={AZ.cy} r={km * perKm} />
            <text class="tick" x={AZ.cx + km * perKm - 5} y={AZ.cy + 16} text-anchor="end">{km} km</text>
          {/each}
          {#each spokes as spoke, index (index)}
            <line class="spoke" class:major={spoke.major} x1={AZ.cx} y1={AZ.cy} x2={spoke.end[0]} y2={spoke.end[1]} />
          {/each}
          <text class="tick" x={AZ.cx} y={AZ.cy - AZ.r - 8} text-anchor="middle">N</text>
          <g class="sweep" style="transform-origin: {AZ.cx}px {AZ.cy}px">
            {#each trail as wedgeOf, index (index)}
              <path class="accentfill" style="opacity: {wedgeOf.opacity}" d={wedgeOf.d} />
            {/each}
            <line class="antenna" x1={AZ.cx} y1={AZ.cy} x2={AZ.cx} y2={AZ.cy - AZ.r} />
          </g>
          <circle class="ink" cx={AZ.cx} cy={AZ.cy} r="5" />
          <path class="orange" d={ray} />
          <circle class="zoomspot" cx={zoomX} cy={zoomY} r="9" />
          <line class="lead" x1={zoomX + 9} y1={zoomY} x2={INSET.x} y2={INSET.y + INSET.h / 2} />
          <rect class="inset" x={INSET.x} y={INSET.y} width={INSET.w} height={INSET.h} rx="8" />
          <text class="label" x={INSET.x + 14} y={INSET.y + 24}>{$_("radar_help.turn.ray")}</text>
          {#each BINS as level, i (i)}
            <rect
              class={level === "none" ? "empty" : ""} fill={level === "none" ? undefined : echo[level]}
              x={INSET.x + 14 + i * binWidth} y={INSET.y + 44} width={binWidth - 2} height="34" rx="2" />
          {/each}
          <text class="small" x={INSET.x + 14} y={INSET.y + 100}>{$_("radar_help.turn.bin")}</text>
          <text class="small" x={INSET.x + 14} y={INSET.y + 114}>{$_("radar_help.turn.colour")}</text>
          {#each ["rays", "bins", "sweep"] as fact, i (i)}
            <text class="fact" x={INSET.x} y={300 + i * 50}>{$_(`radar_help.turn.fact_${fact}`)}</text>
            <text class="small" x={INSET.x} y={318 + i * 50}>{$_(`radar_help.turn.fact_${fact}_sub`)}</text>
          {/each}
        </svg>
      </div>
      <div class="key">
        <span><i class="sw" style="background: {echo.low}"></i>{$_("radar_help.key.light")}</span>
        <span><i class="sw" style="background: {echo.mid}"></i>{$_("radar_help.key.heavy")}</span>
        <span><i class="sw" style="background: {echo.high}"></i>{$_("radar_help.key.hail")}</span>
      </div>
      <figcaption>{$_("radar_help.turn.caption")}</figcaption>
    </figure>

    <!-- Ten tilts make one volume -->
    <div class="col">
      <h3>{$_("radar_help.tilts.title")}</h3>
      <p>{$_("radar_help.tilts.p1")}</p>
      <p>{$_("radar_help.tilts.reach")}</p>
      <p>{$_("radar_help.tilts.p2")}</p>
      <p>{$_("radar_help.tilts.p3")}</p>
    </div>
    <figure>
      <div class="fig">
        <svg viewBox="0 0 920 420" role="img" aria-label={$_("radar_help.tilts.caption")}>
          <defs><clipPath id="radar-help-sky"><rect x={EL.x0} y={EL.y1} width={EL.x1 - EL.x0 + 40} height={EL.y0 - EL.y1} /></clipPath></defs>
          {#each heightTicks as h, index (index)}
            <line class="grid" x1={EL.x0} y1={ey(h)} x2={EL.x1} y2={ey(h)} />
            <text class="tick" x={EL.x0 - 10} y={ey(h) + 4} text-anchor="end">{h}</text>
          {/each}
          {#each distanceTicks as km, index (index)}
            <line class="grid" x1={ex(km)} y1={EL.y1} x2={ex(km)} y2={EL.y0} />
            <text class="tick" x={ex(km)} y={EL.y0 + 20} text-anchor="middle">{km}</text>
          {/each}
          <text class="axis" x={(EL.x0 + EL.x1) / 2} y={EL.y0 + 44} text-anchor="middle">{$_("radar_help.tilts.axis_distance")}</text>
          <text class="axis" transform="translate(22 {(EL.y0 + EL.y1) / 2}) rotate(-90)" text-anchor="middle">{$_("radar_help.tilts.axis_height")}</text>
          <path d={storm[0]} fill={echo.low} />
          <path d={storm[1]} fill={echo.mid} />
          <path d={storm[2]} fill={echo.high} />
          <text class="label" x={ex(98)} y={ey(11.2)}>{$_("radar_help.tilts.storm")}</text>
          <polygon class="wedge" clip-path="url(#radar-help-sky)" points={wedge} />
          <text class="small" x={ex(150)} y={ey(beamHeight(150, 0.5)) + 26} text-anchor="middle">{$_("radar_help.tilts.width")}</text>
          {#each beams as beam, index (index)}
            <polyline class="beam" clip-path="url(#radar-help-sky)" points={beam.points} />
            <text class="beamlabel" x={beam.label.x} y={beam.label.y} text-anchor={beam.label.anchor}>{num(beam.tilt, $locale)}°</text>
            {#if beam.dot}<circle class="accentfill" cx={beam.dot.x} cy={beam.dot.y} r="3" />{/if}
          {/each}
          <text class="small" x={EL.x0 + 6} y={EL.y1 + 18}>{$_("radar_help.tilts.above_1")}</text>
          <text class="small" x={EL.x0 + 6} y={EL.y1 + 32}>{$_("radar_help.tilts.above_2")}</text>
          <path class="ink" d="M{EL.x0 - 7},{EL.y0} L{EL.x0},{EL.y0 - 16} L{EL.x0 + 7},{EL.y0} Z" />
          <circle class="ink" cx={EL.x0} cy={EL.y0 - 18} r="5" />
          <line class="ground" x1={EL.x0} y1={EL.y0} x2={EL.x1 + 30} y2={EL.y0} />
        </svg>
      </div>
      <figcaption>{$_("radar_help.tilts.caption")}</figcaption>
    </figure>

    <!-- Five minutes, minute by minute -->
    <div class="col">
      <h3>{$_("radar_help.cycle.title")}</h3>
      <p>{$_("radar_help.cycle.p1")}</p>
      <p>{$_("radar_help.cycle.p2")}</p>
      <p>{$_("radar_help.cycle.p3")}</p>
    </div>
    <figure>
      <div class="fig">
        <svg viewBox="0 0 980 430" role="img" aria-label={$_("radar_help.cycle.caption")}>
          {#each minuteTicks as m, index (index)}
            <line class="grid" x1={tx(m)} y1="40" x2={tx(m)} y2="390" />
            <text class="tick" x={tx(m)} y="412" text-anchor="middle">{$_("radar_help.cycle.minute", { values: { n: m } })}</text>
          {/each}
          <text class="tick" x={tx(0)} y="30" text-anchor="middle">{$_("radar_help.cycle.t")}</text>
          <text class="tick" x={tx(5)} y="30" text-anchor="middle">{$_("radar_help.cycle.t5")}</text>
          {#each [["antenna", 70], ["files", 170], ["ours", 290]] as [row, y], index (index)}
            <text class="rowname" x="16" y={Number(y) + 22}>{$_(`radar_help.cycle.row_${row}`)}</text>
            <line class="grid" x1={TL.left} y1={Number(y) + 52} x2={TL.right} y2={Number(y) + 52} />
          {/each}
          {#each blocks as block, index (index)}
            <rect class="blk {block.kind}" class:next={block.next} x={tx(block.start)} y="76" width={tx(block.end) - tx(block.start) - 1} height="34" rx="3" />
            {#if block.tilt !== null}
              <text class="blklabel" x={(tx(block.start) + tx(block.end)) / 2} y="98" text-anchor="middle">{num(block.tilt, $locale)}</text>
            {/if}
          {/each}
          <text class="small" x={tx(0.25)} y="128" text-anchor="middle">{$_("radar_help.cycle.blk_pcp")}</text>
          <text class="small" x={tx(1.75)} y="128" text-anchor="middle">{$_("radar_help.cycle.blk_low")}</text>
          <text class="small" x={tx(4)} y="128" text-anchor="middle">{$_("radar_help.cycle.blk_high")}</text>
          <text class="small" x={tx(7.5)} y="128" text-anchor="middle">{$_("radar_help.cycle.blk_next")}</text>

          {#each [[2.1, "HX", -16, "middle"], [2.85, "WN", -32, "middle"], [5.6, "DMAX", -16, "middle"], [7.1, $_("radar_help.cycle.mk_next_hx"), -16, "middle"]] as [m, text, dy, anchor], i (i)}
            <line class="mk" class:next={i === 3} x1={tx(Number(m))} y1="204" x2={tx(Number(m))} y2="222" />
            <circle class="mk" class:next={i === 3} cx={tx(Number(m))} cy="222" r="4" />
            <text class="mklabel" x={tx(Number(m))} y={204 + Number(dy) + 6} text-anchor={String(anchor)}>{text}</text>
          {/each}
          {#each [[3.5, $_("radar_help.cycle.mk_sweep")], [6.5, $_("radar_help.cycle.mk_last")]] as [m, text], index (index)}
            <line class="mk" x1={tx(Number(m))} y1="204" x2={tx(Number(m))} y2="222" />
            <circle class="mk" cx={tx(Number(m))} cy="222" r="4" />
            <text class="mklabel" x={tx(Number(m))} y="244" text-anchor="start">{text}</text>
          {/each}

          <rect class="match" x={tx(6.6)} y="300" width={tx(7.7) - tx(6.6)} height="50" rx="4" />
          <!-- Beside the box rather than under it, clear of the gap's label in every language. -->
          <text class="small" x={tx(7.7) + 10} y="320">{$_("radar_help.cycle.match_1")}</text>
          <text class="small" x={tx(7.7) + 10} y="334">{$_("radar_help.cycle.match_2")}</text>
          {#each [[2.7, $_("radar_help.cycle.mk_frame"), -14], [6.6, $_("radar_help.cycle.mk_clouds"), -14], [7.7, $_("radar_help.cycle.mk_next_frame"), -32]] as [m, text, dy], i (i)}
            <line class="mk ours" class:next={i === 2} x1={tx(Number(m))} y1="322" x2={tx(Number(m))} y2="340" />
            <circle class="mk ours" class:next={i === 2} cx={tx(Number(m))} cy="340" r="4" />
            <text class="mklabel" x={tx(Number(m))} y={322 + Number(dy)} text-anchor="middle">{text}</text>
          {/each}
          <line class="gap" x1={tx(2.7)} y1="356" x2={tx(6.6)} y2="356" />
          <text class="small" x={tx(4.65)} y="374" text-anchor="middle">{$_("radar_help.cycle.gap")}</text>
        </svg>
      </div>
      <figcaption>{$_("radar_help.cycle.caption")}</figcaption>
    </figure>
    <div class="col table">
      <table>
        <thead><tr><th>{$_("radar_help.times.what")}</th><th>{$_("radar_help.times.when")}</th></tr></thead>
        <tbody>
          {#each TIMES as row, index (index)}
            <tr class:ours={OURS_TIMES.has(row)}>
              <td>{$_(`radar_help.times.${row}`)}</td>
              <td class="t">{$_(`radar_help.times.${row}_at`)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="note">{$_("radar_help.times.note")}</p>
    </div>

    <!-- What meteocool makes from which -->
    <div class="col">
      <h3>{$_("radar_help.made.title")}</h3>
    </div>
    <figure>
      <div class="fig">
        <svg viewBox="0 0 1040 700" role="img" aria-label={$_("radar_help.made.caption")}>
          {#each ["measured", "published", "shown"] as head, i (i)}
            <text class="colhead" x={COL_X[i]} y="16">{$_(`radar_help.made.col_${head}`)}</text>
          {/each}
          {#each edges as edge, index (index)}
            <path class="edge" class:strong={edge.strong} d={edge.d} />
            <path class="edge" class:strong={edge.strong} d={edge.head} />
          {/each}
          {#each nodes as node, index (index)}
            <rect class="node {node.kind}" x={node.x} y={node.y} width={node.w} height={NODE_H} rx="7" />
            {#if node.subtitle}
              <text class="nodet" x={node.x + 12} y={node.y + 19}>{$_(`radar_help.nodes.${node.id}`)}</text>
              <text class="nodes" x={node.x + 12} y={node.y + 35}>{$_(`radar_help.nodes.${node.id}_sub`)}</text>
            {:else}
              <text class="nodet" x={node.x + 12} y={node.y + 27}>{$_(`radar_help.nodes.${node.id}`)}</text>
            {/if}
          {/each}
        </svg>
      </div>
      <div class="key">
        <span><i class="sw scan"></i>{$_("radar_help.key.scan")}</span>
        <span><i class="sw file"></i>{$_("radar_help.key.file")}</span>
        <span><i class="sw ours"></i>{$_("radar_help.key.ours")}</span>
      </div>
      <figcaption>{$_("radar_help.made.caption")}</figcaption>
    </figure>
    <div class="col table">
      <table>
        <thead><tr><th>{$_("radar_help.made.on")}</th><th>{$_("radar_help.made.from")}</th><th>{$_("radar_help.made.how")}</th></tr></thead>
        <tbody>
          {#each PRODUCTS as row, index (index)}
            <tr>
              <td>{$_(`radar_help.made.${row}`)}</td>
              <td>{$_(`radar_help.made.${row}_from`)}</td>
              <td>{$_(`radar_help.made.${row}_how`)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Why the 3D clouds trail the flat radar -->
    <div class="col">
      <h3>{$_("radar_help.why.title")}</h3>
      <p>{$_("radar_help.why.p1")}</p>
    </div>
  </div>
</GlassPanel>
