<script lang="ts">
/**
 * The storm's volumetric model, turning, with nothing else in the frame.
 *
 * The 3D map shows the same solid but never on its own: it is one storm among
 * several, at whatever angle the camera happens to be, behind a basemap and a
 * radar drape. Here it is lifted out and rotated slowly, which is the only way
 * to read a shape from a screen -- a still of a translucent 3D object is
 * ambiguous no matter how well it is lit, and the parallax as it turns is what
 * says whether the core is centred, leaning, or hanging in the air.
 *
 * Rendered by hand into a canvas rather than through a 3D library. The mesh is
 * a few hundred flat faces with no textures and no shared lighting, painter's
 * algorithm handles it exactly, and a WebGL engine would cost more bytes than
 * the rest of the popup put together for a picture the size of a postcard.
 *
 * Nothing here is exaggerated vertically: a kilometre up is a kilometre across,
 * so a storm that looks tall and narrow is tall and narrow.
 */
import { onMount, onDestroy } from "svelte";
import { colorSchemeDark } from "../stores";
import { cellVolume, dbzColour } from "../lib/cellVolume";
import type { CellVolumeModel } from "../lib/cellVolume";
import type { VolumeInput } from "../lib/cellVolume";

export let cell: VolumeInput;
export let width = 320;
export let height = 210;

/** Camera height above the horizon. Low, because the vertical is the point. */
const ELEVATION = (19 * Math.PI) / 180;

/** Radians per second. A full turn in about twenty seconds. */
const SPIN = 0.32;

/** Sun over the viewer's left shoulder, in the model's own turning frame. */
const LIGHT: [number, number, number] = [-0.46, -0.58, 0.67];

/** Outlines are decimated again here: this picture is a few hundred pixels wide. */
const FACE_POINTS = 14;

interface Face {
  /** Indices into `verts`, in winding order. */
  idx: number[];
  rgb: [number, number, number];
  alpha: number;
  /** Faces of an opaque ring may be dropped when they point away. */
  cullable: boolean;
}

interface Mesh {
  /** x (east km), y (north km), z (km above sea level), flattened. */
  verts: Float64Array;
  faces: Face[];
}

let canvas: HTMLCanvasElement | null = null;
let frame = 0;
let angle = 0.6;
let dragging = false;
let dragFrom = 0;
let dragAngle = 0;
let auto = true;

$: model = cellVolume(cell);
$: mesh = model ? build(model) : null;
$: dark = $colorSchemeDark;

/** Every ring of every band as flat faces, built once per cell. */
function build(volume: CellVolumeModel): Mesh {
  const ring = resample(volume.outlineKm, FACE_POINTS);
  const n = ring.length;
  const verts: number[] = [];
  const faces: Face[] = [];

  const push = (x: number, y: number, z: number): number => {
    verts.push(x, y, z);
    return verts.length / 3 - 1;
  };

  volume.bands.forEach((band) => {
    const low = band.base / 1000;
    const high = band.top / 1000;
    band.rings.forEach((piece) => {
      const rgb = dbzColour(piece.dbz);
      const { alpha } = piece;
      const cullable = alpha >= 1;

      /** One ring of the annulus, as the four indices per edge quad. */
      const wall = (scale: number, outward: boolean): number[][] => {
        const base: number[] = [];
        const top: number[] = [];
        ring.forEach(([x, y]) => {
          base.push(push(x * scale, y * scale, low));
          top.push(push(x * scale, y * scale, high));
        });
        const quads: number[][] = [];
        for (let i = 0; i < n; i += 1) {
          const j = (i + 1) % n;
          quads.push(outward
            ? [base[i], base[j], top[j], top[i]]
            : [base[j], base[i], top[i], top[j]]);
        }
        return quads;
      };

      wall(piece.outer, true).forEach((idx) => faces.push({ idx, rgb, alpha, cullable }));
      if (piece.inner > 0) {
        wall(piece.inner, false).forEach((idx) => faces.push({ idx, rgb, alpha, cullable }));
      }

      // The roof, as a fan of quads across the annulus -- or a single cap when
      // this ring is the solid core. Split rather than drawn as one path with
      // a hole, because painter's algorithm sorts by depth and a ring-shaped
      // face has no single depth worth sorting by.
      if (piece.inner > 0) {
        const outer = ring.map(([x, y]) => push(x * piece.outer, y * piece.outer, high));
        const inner = ring.map(([x, y]) => push(x * piece.inner, y * piece.inner, high));
        for (let i = 0; i < n; i += 1) {
          const j = (i + 1) % n;
          faces.push({ idx: [outer[i], outer[j], inner[j], inner[i]], rgb, alpha, cullable });
        }
      } else {
        faces.push({
          idx: ring.map(([x, y]) => push(x * piece.outer, y * piece.outer, high)),
          rgb,
          alpha,
          cullable,
        });
      }
    });
  });

  return { verts: Float64Array.from(verts), faces };
}

function resample(ring: [number, number][], count: number): [number, number][] {
  if (ring.length <= count) return ring;
  const step = ring.length / count;
  return Array.from({ length: count }, (_, i) => ring[Math.floor(i * step)]);
}

function draw(): void {
  const context = canvas?.getContext("2d");
  if (!context || !canvas || !mesh || !model) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const ink = dark ? "rgba(235, 238, 245, " : "rgba(20, 24, 32, ";
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const sinE = Math.sin(ELEVATION);
  const cosE = Math.cos(ELEVATION);

  /*
   * The camera, in full.
   *
   * Yaw the world by `angle`, then look at it from `ELEVATION` above the
   * horizon: screen right is east, screen up is `(0, sin, cos)`, and depth
   * towards the viewer is `(0, -cos, sin)`. Orthographic, because a storm is
   * tens of kilometres across seen from far enough away that perspective would
   * only make the near side look bigger than it measures.
   */
  const radius = model.radiusKm;
  const lowKm = Math.min(model.base / 1000, 0);
  const highKm = model.top / 1000;
  const up = (y: number, z: number): number => y * sinE + z * cosE;
  const upLow = Math.min(up(-radius, lowKm), up(radius, lowKm));
  const upHigh = Math.max(up(-radius, highKm), up(radius, highKm));

  const gutter = 34;
  const pad = 10;
  const scale = Math.min(
    (width - gutter - pad * 2) / (2 * radius),
    (height - pad * 2) / Math.max(upHigh - upLow, 0.5),
  );
  const cx = gutter + (width - gutter) / 2;
  const cy = height - pad + upLow * scale;

  const count = mesh.verts.length / 3;
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const sz = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = mesh.verts[i * 3];
    const y = mesh.verts[i * 3 + 1];
    const z = mesh.verts[i * 3 + 2];
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    sx[i] = cx + rx * scale;
    sy[i] = cy - up(ry, z) * scale;
    // Towards the viewer, which is what the faces are sorted on.
    sz[i] = -ry * cosE + z * sinE;
  }

  drawGround(context, model, { cos, sin, sinE, scale, cx, cy, ink });

  const order: number[] = [];
  const depth = new Float64Array(mesh.faces.length);
  mesh.faces.forEach((face, index) => {
    // Back-face culling by the sign of the projected area: a face wound
    // counter-clockwise on screen is pointing at the camera. Only opaque rings
    // are culled -- through the see-through shell the far wall is part of what
    // gives the object its depth.
    if (face.cullable && signedArea(face.idx, sx, sy) >= 0) return;
    let sum = 0;
    face.idx.forEach((v) => { sum += sz[v]; });
    depth[index] = sum / face.idx.length;
    order.push(index);
  });
  order.sort((a, b) => depth[a] - depth[b]);

  order.forEach((index) => {
    const face = mesh!.faces[index];
    const shade = lambert(face.idx, mesh!.verts, cos, sin);
    const [r, g, b] = face.rgb;
    context.fillStyle = `rgba(${Math.round(r * shade)}, ${Math.round(g * shade)}, `
      + `${Math.round(b * shade)}, ${face.alpha})`;
    context.beginPath();
    face.idx.forEach((v, i) => {
      if (i === 0) context.moveTo(sx[v], sy[v]);
      else context.lineTo(sx[v], sy[v]);
    });
    context.closePath();
    context.fill();
  });

  drawRuler(context, { lowKm, highKm, scale, cy, ink });
}

function signedArea(idx: number[], sx: Float64Array, sy: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < idx.length; i += 1) {
    const a = idx[i];
    const b = idx[(i + 1) % idx.length];
    sum += sx[a] * sy[b] - sx[b] * sy[a];
  }
  return sum / 2;
}

/** Flat shading from the face normal, in the model's turning frame. */
function lambert(idx: number[], verts: Float64Array, cos: number, sin: number): number {
  const at = (v: number): [number, number, number] => {
    const x = verts[v * 3];
    const y = verts[v * 3 + 1];
    return [x * cos - y * sin, x * sin + y * cos, verts[v * 3 + 2]];
  };
  const [p, q, r] = [at(idx[0]), at(idx[1]), at(idx[2 % idx.length])];
  const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const dot = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / length);
  return 0.74 + 0.34 * dot;
}

/**
 * The cell's ground outline, under the solid.
 *
 * It is the one piece of context worth keeping: when a storm's echo base is
 * kilometres up, the gap between the outline and the bottom of the solid is
 * the clear air beneath it, and that is a hard thing to see any other way.
 */
function drawGround(
  context: CanvasRenderingContext2D,
  volume: CellVolumeModel,
  view: { cos: number; sin: number; sinE: number; scale: number; cx: number; cy: number; ink: string },
): void {
  const {
    cos, sin, sinE, scale, cx, cy, ink,
  } = view;
  context.beginPath();
  volume.outlineKm.forEach(([x, y], index) => {
    const px = cx + (x * cos - y * sin) * scale;
    const py = cy - (x * sin + y * cos) * sinE * scale;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.closePath();
  context.fillStyle = `${ink}0.09)`;
  context.fill();
  context.strokeStyle = `${ink}0.28)`;
  context.setLineDash([3, 3]);
  context.lineWidth = 1;
  context.stroke();
  context.setLineDash([]);
}

/** A height scale down the left edge, because "tall" needs a number. */
function drawRuler(
  context: CanvasRenderingContext2D,
  view: { lowKm: number; highKm: number; scale: number; cy: number; ink: string },
): void {
  const {
    lowKm, highKm, scale, cy, ink,
  } = view;
  const cosE = Math.cos(ELEVATION);
  const y = (km: number): number => cy - km * cosE * scale;
  const step = highKm > 12 ? 4 : 2;
  const x = 26;

  context.strokeStyle = `${ink}0.3)`;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, y(Math.max(lowKm, 0)));
  context.lineTo(x, y(highKm));
  context.stroke();

  context.fillStyle = `${ink}0.6)`;
  context.font = "9px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let km = 0; km <= highKm + 1e-6; km += step) {
    const py = y(km);
    context.beginPath();
    context.moveTo(x - 3, py);
    context.lineTo(x, py);
    context.stroke();
    context.fillText(String(km), x - 5, py);
  }
  context.textAlign = "left";
  context.fillText("km", 2, y(highKm) - 10);
}

function tick(now: number): void {
  if (auto && !dragging) {
    if (last) angle += ((now - last) / 1000) * SPIN;
    last = now;
  } else {
    last = now;
  }
  draw();
  frame = requestAnimationFrame(tick);
}

let last = 0;

function onPointerDown(event: PointerEvent): void {
  dragging = true;
  dragFrom = event.clientX;
  dragAngle = angle;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  angle = dragAngle + (event.clientX - dragFrom) * 0.012;
}

function onPointerUp(): void {
  dragging = false;
}

onMount(() => {
  // A model that never stops turning is a model that keeps a phone's GPU awake
  // for as long as the popup is open; honour the system preference for stillness
  // by showing a fixed three-quarter view instead.
  auto = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  frame = requestAnimationFrame(tick);
});

onDestroy(() => cancelAnimationFrame(frame));

// Redraw on anything the render depends on that the loop does not own.
$: if (canvas && mesh && dark !== undefined) draw();
</script>

{#if model}
  <canvas
    bind:this={canvas}
    style="width: {width}px; height: {height}px"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    aria-label="Three-dimensional model of the storm cell's reflectivity structure"
  ></canvas>
{/if}

<style>
  canvas {
    display: block;
    /* The drag rotates the model, so the page must not read it as a pan. */
    touch-action: none;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
</style>
