<script lang="ts">
/**
 * The storm as a real surface, cut open, with the core inside it showing.
 *
 * The sibling picture -- `CellModel3D` -- is the honest diagram: every number
 * in it is one DWD publishes, and its shells are stacked outlines, vertical by
 * construction. That is also its limit. A supercell's core leans downshear and
 * hangs out over its own inflow, and a model built from per-threshold areas
 * cannot lean: it draws the core sitting neatly in the middle of the footprint
 * whatever the storm is actually doing.
 *
 * This is built from the radar's own three-dimensional field instead, so the
 * lean is in the data. It is the reason this view exists, and the reason it is
 * offered for a handful of storms rather than all of them.
 *
 * ## Raymarched, not meshed
 *
 * The obvious build is isosurfaces: march a few shells, smooth them, decimate
 * them, ship a mesh. Raymarching the field directly is less code and a better
 * picture. A cloud reads as a cloud largely because its boundary is soft, and a
 * triangle mesh has no soft boundary; a transfer function does, for free. And
 * the cut is a plane test in the fragment shader rather than a capping problem
 * -- there is no hollow shell to expose, because the volume is solid all the
 * way through, so slicing it simply reveals what is inside.
 *
 * ## Written against WebGL2 directly
 *
 * For the same reason `CellModel3D` is drawn by hand into a 2D canvas: this is
 * one quad, one shader and one texture, and a 3D engine would cost more bytes
 * than everything else in the popup for a picture the size of a postcard. The
 * only thing wanted from WebGL here is `sampler3D`, which is exactly what
 * WebGL2 adds.
 *
 * ## What is stylised and what is measured
 *
 * The lighting, the opacity ramp and the choice of where to cut are all chosen
 * to look right. The field is not: reflectivity is the strongest radar's
 * reading, and opacity is multiplied by how well the beams actually reached
 * each voxel, so unsampled air fades out rather than ending in a crisp
 * surface. The label under the canvas says so, because a reader who cannot
 * tell this from the measured view will over-read it.
 */
import { onDestroy, onMount, tick } from "svelte";
import { FRAMING_DBZ, loadCutaway } from "../lib/cellCutaway";
import type { Cutaway } from "../lib/cellCutaway";
import { dbzColour } from "../lib/cellVolume";
import { cutRotationDeg } from "../stores";
import { cutLabel, cutSnapLabels, normaliseCut } from "../lib/cutAngle";
import type { CellVolume } from "../api";

export let volume: CellVolume;
/**
 * Where the storm is going, degrees clockwise from north.
 *
 * The cut is taken along it. A cross-section across the direction of travel
 * shows the storm's width and hides the overhang, which lies downshear -- and
 * downshear is, near enough, where the storm is heading. Null falls back to a
 * north-south cut, which is arbitrary and says so by being the same for every
 * storm.
 */
export let headingDeg: number | null = null;
export let width = 320;
export let height = 210;

let canvas: HTMLCanvasElement;
let cutaway: Cutaway | null = null;
let failed: string | null = null;
let frame = 0;
let controller: AbortController | null = null;
let gl: WebGL2RenderingContext | null = null;

/** How far round the storm has turned, radians. */
let spin = 0;

/*
 * The drag turns the slice, not the camera.
 *
 * The camera already turns on its own, which is what gives the parallax; the
 * slice is the one thing a reader wants to put somewhere, and the obvious
 * gesture for it is to take hold of it. The spin pauses while the finger is
 * down, so the plane stays under it instead of sliding off as the view turns.
 */
let dragging = false;
let dragFrom = 0;
let dragCut = 0;
/** Degrees of slice per pixel dragged: a full half-turn across a phone screen. */
const DRAG_DEG_PER_PX = 0.6;

/** Honoured as in `CellModel3D`: no spin, a fixed three-quarter view. */
let still = false;
/** Seconds for a full turn. Slow: the parallax is the point, not the motion. */
const TURN_SECONDS = 24;
/** Samples along each ray. Enough that the banding is gone on a postcard. */
const STEPS = 160;
/**
 * Below this the echo is drizzle, clutter or the outermost fringe of the anvil.
 * Shared with the framing, or the camera frames air the shader does not draw.
 */
const DBZ_LOW = FRAMING_DBZ;
/**
 * Where the echo has become as opaque as it gets.
 *
 * Low enough that the envelope is a visible cloud rather than a hint: with the
 * ceiling up at the core's own reflectivity the storm renders as its core
 * floating in clear air, which is both wrong and the one thing this picture is
 * supposed to put in context.
 */
const DBZ_HIGH = 34;

const VERTEX = `#version 300 es
void main() {
  // One oversized triangle rather than a quad: no seam down the diagonal and
  // one less vertex to think about.
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uRamp;
uniform vec3 uHalf;        // half-extent of the box, in kilometres
uniform vec3 uEye;         // camera position, same frame
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uViewport;
uniform vec3 uPlaneNormal; // the cut; everything on its positive side is gone
uniform vec3 uPlanePoint;  // and it passes through here, not through the origin
uniform float uDbzFloor;
uniform float uDbzScale;
uniform float uSteps;

out vec4 fragColour;

/** Where a ray enters and leaves the box, or nothing. */
bool hitBox(vec3 origin, vec3 direction, out float near, out float far) {
  vec3 inverse = 1.0 / direction;
  vec3 a = (-uHalf - origin) * inverse;
  vec3 b = (uHalf - origin) * inverse;
  vec3 low = min(a, b);
  vec3 high = max(a, b);
  near = max(max(low.x, low.y), low.z);
  far = min(min(high.x, high.y), high.z);
  return far > max(near, 0.0);
}

vec3 toTexture(vec3 p) { return (p + uHalf) / (2.0 * uHalf); }

/** Reflectivity in dBZ, and how well that voxel was actually seen. */
vec2 sampleField(vec3 p) {
  vec2 raw = texture(uVolume, toTexture(p)).rg;
  return vec2(raw.r * 255.0 / uDbzScale + uDbzFloor, raw.g);
}

/**
 * The gradient of what is drawn, which is what gives the cloud its shape.
 *
 * Taken over reflectivity weighted by confidence rather than over reflectivity
 * alone: at the edge of coverage the field simply stops, and lighting that
 * boundary would carve a bright rim onto the place where the radar ran out.
 */
vec3 fieldNormal(vec3 p, float step) {
  vec3 d = vec3(step, 0.0, 0.0);
  float dx = dot(sampleField(p + d.xyz), vec2(0.02, 1.0)) - dot(sampleField(p - d.xyz), vec2(0.02, 1.0));
  float dy = dot(sampleField(p + d.zxy), vec2(0.02, 1.0)) - dot(sampleField(p - d.zxy), vec2(0.02, 1.0));
  float dz = dot(sampleField(p + d.yzx), vec2(0.02, 1.0)) - dot(sampleField(p - d.yzx), vec2(0.02, 1.0));
  vec3 g = vec3(dx, dy, dz);
  return length(g) > 1e-5 ? normalize(-g) : vec3(0.0, 0.0, 1.0);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  ndc.x *= uViewport.x / uViewport.y;
  // A narrow field of view, about 42 degrees across the short side. Wider
  // looks like a fisheye at this distance and, more to the point, leaves the
  // storm small in a panel that is only two hundred pixels tall.
  vec3 direction = normalize(uForward + (uRight * ndc.x + uUp * ndc.y) * 0.38);

  float near, far;
  if (!hitBox(uEye, direction, near, far)) { fragColour = vec4(0.0); return; }
  near = max(near, 0.0);

  // The cut, done to the ray rather than to every sample along it.
  //
  // Testing each sample and skipping it works, but the first sample that
  // survives lands wherever the march happens to put it, so the exposed face
  // comes out as a staircase one step deep. Trimming the interval against the
  // plane instead puts the face exactly on it, costs two operations rather
  // than one per step, and makes the cut surface the thing the ray starts on.
  float facing = dot(direction, uPlaneNormal);
  float atPlane = dot(uPlanePoint - uEye, uPlaneNormal);
  bool cutFace = false;
  if (abs(facing) < 1e-6) {
    // Parallel: the whole ray is on one side or the other.
    if (atPlane < 0.0) { fragColour = vec4(0.0); return; }
  } else {
    float t = atPlane / facing;
    if (facing > 0.0) {
      far = min(far, t);
    } else if (t > near) {
      near = t;
      cutFace = true;
    }
  }
  if (far <= near) { fragColour = vec4(0.0); return; }

  float dt = (far - near) / uSteps;
  vec3 light = normalize(vec3(-0.45, -0.7, 0.75));
  vec4 accumulated = vec4(0.0);

  // Start each ray a random fraction of a step in.
  //
  // Neighbouring rays otherwise sample at the same depths, so a sharp boundary
  // in the field -- the edge of a radar's coverage, say -- lands between the
  // same two steps all the way along it and comes out as a staircase. Jittered,
  // the same error becomes fine noise, which the eye reads as texture rather
  // than as a feature of the storm.
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  for (float i = 0.0; i < uSteps; i += 1.0) {
    vec3 p = uEye + direction * (near + dt * (i + dither));
    vec2 field = sampleField(p);
    float density = smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, field.x) * field.y;
    if (density <= 0.002) continue;

    vec3 colour = texture(uRamp, vec2(clamp((field.x + 32.0) / 96.0, 0.0, 1.0), 0.5)).rgb;

    float alpha;
    if (cutFace && i < 1.0) {
      // The sliced surface itself, drawn flat and solid: the whole point of
      // cutting the storm open is that this face shows structure the outside
      // hides, and shading it like more cloud would throw that away.
      //
      // Averaged over a second tap just behind it, because one opaque sample
      // of a trilinearly filtered texture facets along the voxel grid, and on
      // a flat bright surface those facets are the most visible thing in the
      // picture.
      vec2 behind = sampleField(p + direction * dt * 0.5);
      float smoothed = 0.5 * (density + smoothstep(${DBZ_LOW}.0, ${DBZ_HIGH}.0, behind.x) * behind.y);
      alpha = clamp(smoothed * 2.1, 0.0, 1.0);
      colour *= 1.12;
    } else {
      vec3 normal = fieldNormal(p, dt);
      float lambert = 0.42 + 0.58 * max(dot(normal, light), 0.0);
      alpha = clamp(density * dt * 0.62, 0.0, 1.0);
      colour *= lambert;
    }

    accumulated.rgb += (1.0 - accumulated.a) * colour * alpha;
    accumulated.a += (1.0 - accumulated.a) * alpha;
    if (accumulated.a > 0.985) break;
  }

  fragColour = accumulated;
}`;

function compile(context: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = context.createShader(type)!;
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    throw new Error(context.getShaderInfoLog(shader) ?? "shader would not compile");
  }
  return shader;
}

/**
 * The reflectivity ramp as a texture the shader can look up.
 *
 * Built from the same stops the flat map and the measured model use, so a core
 * that reads as severe there reads as severe here. Spanning -32 to +64 dBZ,
 * which is the range the stored byte covers.
 */
function rampTexture(context: WebGL2RenderingContext): WebGLTexture {
  const pixels = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const [r, g, b] = dbzColour(-32 + (i / 255) * 96);
    pixels.set([r, g, b, 255], i * 4);
  }
  const texture = context.createTexture()!;
  context.bindTexture(context.TEXTURE_2D, texture);
  context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 256, 1, 0, context.RGBA, context.UNSIGNED_BYTE, pixels);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  return texture;
}

function volumeTexture(context: WebGL2RenderingContext, loaded: Cutaway): WebGLTexture {
  const { header, voxels } = loaded;
  const texture = context.createTexture()!;
  context.bindTexture(context.TEXTURE_3D, texture);
  context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
  context.texImage3D(
    context.TEXTURE_3D, 0, context.RG8,
    header.nx, header.ny, header.nz, 0,
    context.RG, context.UNSIGNED_BYTE, voxels,
  );
  // Clamped rather than wrapped: a ray leaving the box must find empty air, not
  // the far side of the storm folded back in.
  for (const axis of [context.TEXTURE_WRAP_S, context.TEXTURE_WRAP_T, context.TEXTURE_WRAP_R]) {
    context.texParameteri(context.TEXTURE_3D, axis, context.CLAMP_TO_EDGE);
  }
  context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MIN_FILTER, context.LINEAR);
  context.texParameteri(context.TEXTURE_3D, context.TEXTURE_MAG_FILTER, context.LINEAR);
  return texture;
}

function start(loaded: Cutaway): void {
  const context = canvas.getContext("webgl2", { alpha: true, antialias: false });
  if (!context) { failed = "no webgl2"; return; }
  gl = context;

  const program = context.createProgram()!;
  context.attachShader(program, compile(context, context.VERTEX_SHADER, VERTEX));
  context.attachShader(program, compile(context, context.FRAGMENT_SHADER, FRAGMENT));
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    failed = context.getProgramInfoLog(program) ?? "shader would not link";
    return;
  }
  context.useProgram(program);

  const at = (name: string) => context.getUniformLocation(program, name);
  context.activeTexture(context.TEXTURE0);
  volumeTexture(context, loaded);
  context.uniform1i(at("uVolume"), 0);
  context.activeTexture(context.TEXTURE1);
  rampTexture(context);
  context.uniform1i(at("uRamp"), 1);

  // Kilometres, and the same on every axis: a kilometre up is a kilometre
  // across, so a storm that looks tall and narrow is tall and narrow.
  const half: [number, number, number] = [
    loaded.extentM[0] / 2000, loaded.extentM[1] / 2000, loaded.extentM[2] / 2000,
  ];
  context.uniform3fv(at("uHalf"), half);
  context.uniform1f(at("uDbzFloor"), loaded.header.dbz_floor);
  context.uniform1f(at("uDbzScale"), loaded.header.dbz_scale);
  context.uniform1f(at("uSteps"), STEPS);

  // Through the storm, not the middle of the box. The plane's direction is set
  // every frame below, because the reader can turn it.
  context.uniform3fv(at("uPlanePoint"), loaded.centreKm);
  const planeNormal = at("uPlaneNormal");

  context.enable(context.BLEND);
  context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);

  let last = performance.now();
  const draw = (now: number) => {
    if (!dragging && !still) spin += ((now - last) / 1000) * ((Math.PI * 2) / TURN_SECONDS);
    last = now;

    // Along the track by default, turned by however far the reader has dragged
    // it; the normal is the cut's direction rotated a quarter turn.
    const along = (((headingDeg ?? 0) + $cutRotationDeg) * Math.PI) / 180;
    context.uniform3fv(planeNormal, [Math.cos(along), -Math.sin(along), 0]);

    // Framed on the storm rather than on the box. A cell rarely fills 40 km,
    // and a camera set to the box draws most of them as a speck in empty air.
    const target = loaded.centreKm;
    const reach = Math.max(loaded.halfKm[0], loaded.halfKm[1], loaded.halfKm[2]);
    const distance = reach * 2.3;
    const tilt = 0.32;
    const eye: [number, number, number] = [
      target[0] + Math.sin(spin) * distance * Math.cos(tilt),
      target[1] - Math.cos(spin) * distance * Math.cos(tilt),
      target[2] + Math.sin(tilt) * distance,
    ];
    const forward = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]] as [number, number, number];
    const length = Math.hypot(...forward);
    const f = forward.map((v) => v / length) as [number, number, number];
    // World up is z, so right is f x z normalised and up closes the basis.
    const right: [number, number, number] = [f[1], -f[0], 0];
    const rl = Math.hypot(right[0], right[1]) || 1;
    const r: [number, number, number] = [right[0] / rl, right[1] / rl, 0];
    const u: [number, number, number] = [
      r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0],
    ];

    context.uniform3fv(at("uEye"), eye);
    context.uniform3fv(at("uForward"), f);
    context.uniform3fv(at("uRight"), r);
    context.uniform3fv(at("uUp"), u);
    context.uniform2fv(at("uViewport"), [canvas.width, canvas.height]);

    context.viewport(0, 0, canvas.width, canvas.height);
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT);
    context.drawArrays(context.TRIANGLES, 0, 3);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
}

function onPointerDown(event: PointerEvent): void {
  dragging = true;
  dragFrom = event.clientX;
  dragCut = $cutRotationDeg;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  cutRotationDeg.set(normaliseCut(dragCut + (event.clientX - dragFrom) * DRAG_DEG_PER_PX));
}

function onPointerUp(): void {
  dragging = false;
}

/** Arrow keys turn the slice too, a few degrees at a time, for anyone not dragging. */
function onKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 15 : 5;
  if (event.key === "ArrowLeft") cutRotationDeg.set(normaliseCut($cutRotationDeg - step));
  else if (event.key === "ArrowRight") cutRotationDeg.set(normaliseCut($cutRotationDeg + step));
  else return;
  event.preventDefault();
}

onMount(() => {
  still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) spin = Math.PI * 0.25;
  // Not reset to zero here any more: the slice follows the selection rather
  // than this component's lifetime -- see the rule beside the other selection
  // rules in App.svelte -- so a link that opens a storm cut at 40 degrees is
  // not undone by the panel mounting a moment later.
  controller = new AbortController();
  loadCutaway(volume, controller.signal)
    .then(async (loaded) => {
      cutaway = loaded;
      // The canvas is inside `{#if cutaway}`, so it does not exist until
      // Svelte has flushed that assignment. `tick` is the only thing that
      // promises it has: a microtask of our own races the framework's.
      await tick();
      if (canvas) start(loaded);
    })
    .catch((error: Error) => {
      if (error.name !== "AbortError") failed = error.message;
    });
});

onDestroy(() => {
  controller?.abort();
  if (frame) cancelAnimationFrame(frame);
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
});

// No track, no direction of travel: the slice is measured from north, and the
// caption and buttons say so rather than naming a track that was never measured.
$: reference = headingDeg == null ? ("north" as const) : ("track" as const);
$: [snapA, snapB] = cutSnapLabels(reference);

// Capped at two: the marching cost is per pixel, and a phone at three times
// density would triple it for a difference nobody can see on a postcard.
const ratio = typeof devicePixelRatio === "number" ? Math.min(devicePixelRatio, 2) : 1;
</script>

{#if failed}
  <p class="unavailable">Volume unavailable</p>
{:else if cutaway}
  <figure>
    <canvas
      bind:this={canvas}
      width={Math.round(width * ratio)}
      height={Math.round(height * ratio)}
      style="width: {width}px; height: {height}px;"
      tabindex="0"
      role="slider"
      aria-label="Turn the slice through the storm"
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={Math.round($cutRotationDeg)}
      aria-valuetext={cutLabel($cutRotationDeg, reference)}
      on:pointerdown={onPointerDown}
      on:pointermove={onPointerMove}
      on:pointerup={onPointerUp}
      on:pointercancel={onPointerUp}
      on:keydown={onKey}
    ></canvas>
    <div class="cuts">
      <button type="button" class:on={Math.abs($cutRotationDeg) < 1 || Math.abs($cutRotationDeg) > 179}
        on:click={() => cutRotationDeg.set(0)}>{snapA}</button>
      <button type="button" class:on={Math.abs(Math.abs($cutRotationDeg) - 90) < 1}
        on:click={() => cutRotationDeg.set(90)}>{snapB}</button>
    </div>
    <figcaption>
      Stylised. Radar volume from {cutaway.header.sites.join(", ")},
      {cutLabel($cutRotationDeg, reference)}.
    </figcaption>
  </figure>
{/if}

<style>
figure { margin: 0; }
canvas {
  display: block;
  /* The drag turns the slice, so the page must not read it as a pan. */
  touch-action: none;
  cursor: ew-resize;
}
canvas:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.cuts { display: flex; gap: 0.35rem; margin-top: 0.35rem; }
.cuts button {
  font: inherit;
  font-size: 0.7rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}
.cuts button.on { opacity: 1; }
figcaption {
  font-size: 0.7rem;
  opacity: 0.6;
  margin-top: 0.25rem;
}
.unavailable {
  font-size: 0.75rem;
  opacity: 0.6;
}
</style>
