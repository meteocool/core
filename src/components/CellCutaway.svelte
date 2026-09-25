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
import { loadCutaway } from "../lib/cellCutaway";
import { createRaymarcher, type Raymarcher } from "../lib/volumeRaymarch";
import type { Cutaway } from "../lib/cellCutaway";
import { cutRotationDeg, cutSweepDeg, radarColormap } from "../stores";
import { stopSweep } from "../lib/cutSweep";
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
let raymarcher: Raymarcher | null = null;

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
function start(loaded: Cutaway): void {
  const made = createRaymarcher(canvas, loaded, $radarColormap);
  if (typeof made === "string") { failed = made; return; }
  raymarcher = made;

  let last = performance.now();
  const draw = (now: number) => {
    if (!dragging && !still) spin += ((now - last) / 1000) * ((Math.PI * 2) / TURN_SECONDS);
    last = now;

    // Along the track by default, turned by however far the reader has dragged
    // it; the normal is the cut's direction rotated a quarter turn.
    const along = (((headingDeg ?? 0) + $cutRotationDeg + $cutSweepDeg) * Math.PI) / 180;

    // Framed on the storm rather than on the box. A cell rarely fills 40 km,
    // and a camera set to the box draws most of them as a speck in empty air.
    const target = loaded.centreKm;
    const reach = Math.max(loaded.halfKm[0], loaded.halfKm[1], loaded.halfKm[2]);
    const distance = reach * 2.3;
    const tilt = 0.32;
    made.render({
      eye: [
        target[0] + Math.sin(spin) * distance * Math.cos(tilt),
        target[1] - Math.cos(spin) * distance * Math.cos(tilt),
        target[2] + Math.sin(tilt) * distance,
      ],
      target,
      planeNormal: [Math.cos(along), -Math.sin(along), 0],
      // Through the storm, not the middle of the box.
      planePoint: loaded.centreKm,
    });
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
}

function onPointerDown(event: PointerEvent): void {
  dragging = true;
  dragFrom = event.clientX;
  stopSweep(true);
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
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") stopSweep(true);
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
  raymarcher?.dispose();
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
      aria-valuetext={cutLabel($cutRotationDeg + $cutSweepDeg, reference)}
      on:pointerdown={onPointerDown}
      on:pointermove={onPointerMove}
      on:pointerup={onPointerUp}
      on:pointercancel={onPointerUp}
      on:keydown={onKey}
    ></canvas>
    <div class="cuts">
      <button type="button" class:on={Math.abs($cutRotationDeg) < 1 || Math.abs($cutRotationDeg) > 179}
        on:click={() => { stopSweep(false); cutRotationDeg.set(0); }}>{snapA}</button>
      <button type="button" class:on={Math.abs(Math.abs($cutRotationDeg) - 90) < 1}
        on:click={() => { stopSweep(false); cutRotationDeg.set(90); }}>{snapB}</button>
    </div>
    <figcaption>
      Stylised. Radar volume from {cutaway.header.sites.join(", ")},
      {cutLabel($cutRotationDeg + $cutSweepDeg, reference)}.
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
