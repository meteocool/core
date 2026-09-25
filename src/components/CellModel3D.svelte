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
import { colorSchemeDark, radarColormap } from "../stores";
import { cellVolume, dbzColour, frameOf } from "../lib/cellVolume";
import type { CellVolumeModel, ModelFrame } from "../lib/cellVolume";
import type { VolumeInput } from "../lib/cellVolume";

export let cell: VolumeInput;
export let width = 320;
export let height = 210;

/**
 * The extent the picture is scaled to fit, when something outside knows a
 * better one than this cell.
 *
 * Without it every cell is normalised to fill the canvas, so a 4 km shower and
 * a 40 km supercell come out the same size and the only thing that says
 * otherwise is the ruler -- which makes walking a family actively misleading,
 * because the one quantity the eye reads first is the one that carries no
 * information. Passing the family's envelope in means a cell that is half the
 * size of its parent is drawn half the size of its parent.
 *
 * Null falls back to this cell's own extent, i.e. the old behaviour, which is
 * what a cell with no known relatives gets.
 */
export let frame: ModelFrame | null = null;

/**
 * How fast the frame catches up when it changes, per second of easing.
 *
 * The frame moves for two reasons -- a hop to another cell, and the family
 * arriving in rounds behind the first paint -- and both used to be an
 * instantaneous jump in a picture that is otherwise always moving smoothly.
 * Easing it reads as the camera pulling back rather than as the model being
 * replaced. Snapped below a thousandth so it settles rather than creeping.
 */
const FRAME_EASE = 6;

/** The frame actually drawn this instant, chasing the target one. */
let shown: ModelFrame | null = null;
let shownAt = 0;

/** Asked once: a reader who wants less movement gets the frame outright. */
const stillness = typeof window === "undefined" || !window.matchMedia
  ? null
  : window.matchMedia("(prefers-reduced-motion: reduce)");

/** Camera height above the horizon. Low, because the vertical is the point. */
const ELEVATION = (19 * Math.PI) / 180;

/** Radians per second. A full turn in about twenty seconds. */
const SPIN = 0.32;

/**
 * How far the model turns on its own before it comes to rest.
 *
 * One turn shows every side, which is what the turning is for. Turning for as
 * long as the popup was open kept a phone's GPU awake for the whole of a
 * reading -- and, with the cutaway beside it, two canvases redrawing at the
 * display's rate under a panel of numbers. After the turn the model rests
 * and is drawn again only when something changes: a drag, a hop to another
 * cell, the frame easing, the theme.
 */
const SPIN_TURNS = 1;

/** Frames a second while it is moving. Half the display's rate is plenty for a slow turn. */
const MODEL_FPS = 30;

/** Sun over the viewer's left shoulder, in the model's own turning frame. */
const LIGHT: [number, number, number] = [-0.46, -0.58, 0.67];

/** Height-ruler steps, in km: the first that clears `MIN_TICK_PX` is used. */
const RULER_STEPS_KM = [1, 2, 5, 10, 20];

/** Closest two ruler labels may sit before they stop being two labels. */
const MIN_TICK_PX = 13;

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
/** The pending animation-frame handle; `frame` is the prop above. */
let rafId = 0;
let angle = 0.6;
/** How far the model has turned on its own, radians. */
let spun = 0;
let dragging = false;
let dragFrom = 0;
let dragAngle = 0;
let auto = true;
/** Whether the canvas is on screen; a picture scrolled out of view is not drawn. */
let visible = true;
let lastDrawAt = 0;

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
      const rgb = dbzColour(piece.dbz, $radarColormap);
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
  const up = (y: number, z: number): number => y * sinE + z * cosE;

  /*
   * What the picture is scaled to fit: the family's envelope when the panel
   * knows one, this cell's own extent otherwise. Everything below reads the
   * frame rather than the model, so the ground line and the ruler stay put
   * across a hop too -- a shared scale with a baseline that still moves would
   * only trade one misreading for another.
   */
  const fit = approach(frame ?? frameOf(model));

  const radius = fit.radiusKm;
  const lowKm = fit.lowKm;
  const highKm = fit.highKm;
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

/**
 * The frame to draw this instant, eased toward `target`.
 *
 * Exponential, on wall-clock time rather than on frames, so it lands in the
 * same fifth of a second whether the tab is running at 120Hz or has been
 * throttled to 10. The first call of a component's life snaps: there is
 * nothing to ease from, and starting at some arbitrary box would mean every
 * cell opened with a lurch.
 */
function approach(target: ModelFrame): ModelFrame {
  const now = typeof performance === "undefined" ? Date.now() : performance.now();
  const dt = shown ? Math.min((now - shownAt) / 1000, 0.25) : 0;
  shownAt = now;
  if (!shown || stillness?.matches) {
    shown = { ...target };
    return shown;
  }
  const k = 1 - Math.exp(-FRAME_EASE * dt);
  const step = (from: number, to: number): number => (
    Math.abs(to - from) < 1e-3 ? to : from + (to - from) * k
  );
  shown = {
    radiusKm: step(shown.radiusKm, target.radiusKm),
    lowKm: step(shown.lowKm, target.lowKm),
    highKm: step(shown.highKm, target.highKm),
  };
  return shown;
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

  /*
   * The step comes from the room there is, not from how tall the storm is.
   *
   * It used to be `highKm > 12 ? 4 : 2`, which was safe only while every cell
   * was normalised to fill the canvas -- the scale was then roughly the same
   * every time, so a height alone predicted the spacing. Now that a cell is
   * drawn on its family's scale a small one can be at a quarter of that, and a
   * 2 km step that used to be 25px apart lands at six: the labels collide into
   * an unreadable column. Picking the first step on the ladder that clears a
   * legible gap holds at any scale, and keeps the familiar 2 km ticks wherever
   * they still fit.
   */
  const step = RULER_STEPS_KM.find((km) => km * cosE * scale >= MIN_TICK_PX)
    ?? RULER_STEPS_KM[RULER_STEPS_KM.length - 1];
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

/** Whether the frame has caught up with its target; see `approach`. */
function settled(): boolean {
  if (!shown || !model) return true;
  const target = frame ?? frameOf(model);
  return Math.abs(shown.radiusKm - target.radiusKm) < 1e-3
    && Math.abs(shown.lowKm - target.lowKm) < 1e-3
    && Math.abs(shown.highKm - target.highKm) < 1e-3;
}

/** Whether anything is moving, which is the only reason to keep drawing. */
function moving(): boolean {
  return dragging || (auto && spun < SPIN_TURNS * Math.PI * 2) || !settled();
}

function tick(now: number): void {
  rafId = 0;
  if (!canvas || !visible) return;
  if (auto && !dragging && spun < SPIN_TURNS * Math.PI * 2) {
    if (last) {
      const turned = (Math.min(now - last, 250) / 1000) * SPIN;
      angle += turned;
      spun += turned;
    }
  }
  last = now;
  if (now - lastDrawAt >= 1000 / MODEL_FPS - 1) {
    draw();
    lastDrawAt = now;
  }
  if (moving()) rafId = requestAnimationFrame(tick);
}

let last = 0;

/** Start the loop if something is moving and it is not already running. */
function ensureLoop(): void {
  if (rafId || !canvas || !visible || !moving()) return;
  last = 0;
  rafId = requestAnimationFrame(tick);
}

/** Pause the loop while the canvas is scrolled out of view, and resume it when it is back. */
function watchVisibility(node: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") return undefined;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) ensureLoop();
  });
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}

function onPointerDown(event: PointerEvent): void {
  dragging = true;
  dragFrom = event.clientX;
  dragAngle = angle;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  ensureLoop();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  angle = dragAngle + (event.clientX - dragFrom) * 0.012;
}

function onPointerUp(): void {
  dragging = false;
}

onMount(() => {
  // Honour the system preference for stillness by showing a fixed
  // three-quarter view instead of the turn.
  auto = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
});

onDestroy(() => cancelAnimationFrame(rafId));

// Redraw on anything the render depends on that the loop does not own, and
// run the loop while the frame is easing towards a new target.
$: if (canvas && mesh && dark !== undefined) draw();
$: if (canvas && (mesh || frame)) ensureLoop();
</script>

{#if model}
  <canvas
    bind:this={canvas}
    use:watchVisibility
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
