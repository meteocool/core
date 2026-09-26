<script lang="ts">
/**
 * The storm as a CAPPI that climbs and sinks through it.
 *
 * A CAPPI -- constant altitude plan position indicator -- is the radar
 * meteorologist's horizontal slice: the reflectivity at one height,
 * everywhere. Here it is drawn in 3D, as the flat top of the volume with
 * everything above the height cut away, and the height moves slowly up and
 * down the storm. That is the reading a single slice cannot give: the core
 * widening or narrowing with height, the weak-echo vault a strong updraft
 * leaves low down, the anvil spreading out at the top.
 *
 * The same raymarcher as the vertical cross-section, with the plane lying
 * flat -- see `volumeRaymarch.ts`. The ruler beside it is the height, because
 * a slice with no height on it is a colour field and nothing more.
 *
 * It draws at a capped rate, only while on screen, and rests after a couple
 * of sweeps: it opens beside the 3D map, which is raymarching the same storm
 * every frame already, and it used to go on marching at the display's rate
 * for as long as the panel stayed open -- scrolled out of view included.
 */
import { onDestroy, onMount, tick } from "svelte";
import { loadCutaway } from "../lib/cellCutaway";
import type { Cutaway } from "../lib/cellCutaway";
import { createRaymarcher, type Raymarcher } from "../lib/volumeRaymarch";
import { radarColormap } from "../stores";
import type { CellVolume } from "../api";

export let volume: CellVolume;
export let width = 300;
export let height = 200;

/** Seconds from the storm's base to its top and back. Slow enough to read each height. */
const CYCLE_SECONDS = 16;
/** Seconds for the camera to go round once: parallax, not motion. */
const TURN_SECONDS = 60;
/** How far above the horizon the camera looks down, radians: enough to see the slice face on. */
const TILT = 0.72;
/** Kilometres of height per pixel dragged. */
const DRAG_KM_PER_PX = 0.04;
/** The ruler's width, taken out of the canvas's. */
const RULER_PX = 44;
/** Frames a second while it moves: the slice climbs a few pixels a second. */
const FPS = 24;
/** Sweeps from base to top and back before it rests, at the storm's upper middle. */
const CYCLES = 2;
/** Where it rests, from base to top. */
const REST_AT = 0.6;

let canvas: HTMLCanvasElement;
let cutaway: Cutaway | null = null;
let failed: string | null = null;
let raymarcher: Raymarcher | null = null;
let controller: AbortController | null = null;
let still = false;

/** The slice's height above the box floor, in km. */
let heightKm = 0;
/** Where it sweeps between: the echo's base and its top, from the volume's own framing. */
let lowKm = 0;
let highKm = 8;
/** The whole box, for the ruler's scale. */
let ceilingKm = 16;
/** Cycles swept so far, fractional. */
let phase = 0;
/**
 * Where the sweep ends: after `CYCLES` whole cycles, part way up the next one
 * to the resting height, so it comes to rest rather than jumping there.
 */
const END_PHASE = CYCLES + Math.acos(1 - 2 * REST_AT) / (2 * Math.PI);
/** Done sweeping: it has come to rest, or a reader has put it somewhere. */
let resting = false;
/** Draws one frame at the current height; set once the shader is up. */
let render: (() => void) | null = null;
/** Whether the canvas is on screen; a slice scrolled out of view is not drawn. */
let visible = true;

let dragging = false;
let dragFrom = 0;
let dragHeight = 0;

const clamp = (value: number) => Math.min(highKm, Math.max(lowKm, value));

function start(loaded: Cutaway): void {
  const made = createRaymarcher(canvas, loaded, $radarColormap);
  if (typeof made === "string") { failed = made; return; }
  raymarcher = made;

  const halfBox = loaded.extentM[2] / 2000;
  ceilingKm = loaded.extentM[2] / 1000;
  // From just under the echo's base to a little over its top, so the sweep
  // shows the storm whole at one end and all but gone at the other.
  lowKm = Math.max(0.25, halfBox + loaded.centreKm[2] - loaded.halfKm[2]);
  highKm = Math.min(ceilingKm, halfBox + loaded.centreKm[2] + loaded.halfKm[2] + 0.5);
  heightKm = still ? lowKm + (highKm - lowKm) * REST_AT : lowKm;

  const reach = Math.max(loaded.halfKm[0], loaded.halfKm[1], 4);
  const distance = reach * 2.6;

  render = () => {
    // Looking at what is left of the storm, not at its middle: cut low, all
    // that remains is a slab near the ground, and a camera aimed at the
    // storm's centre put it at the bottom of the picture.
    const target: [number, number, number] = [
      loaded.centreKm[0], loaded.centreKm[1], (lowKm + heightKm) / 2 - halfBox,
    ];
    made.render({
      eye: [
        target[0] + Math.sin(spin) * distance * Math.cos(TILT),
        target[1] - Math.cos(spin) * distance * Math.cos(TILT),
        target[2] + Math.sin(TILT) * distance,
      ],
      target,
      planeNormal: [0, 0, 1],
      planePoint: [0, 0, heightKm - halfBox],
    });
  };
  requestDraw();
}

/** The camera's angle round the storm, radians. */
let spin = Math.PI * 0.25;
let frame = 0;
let lastTickAt = 0;
let lastDrawAt = 0;

/** Whether it is still sweeping on its own. */
function sweeping(): boolean {
  return !still && !dragging && !resting;
}

function step(now: number): void {
  frame = 0;
  if (!render || !visible) return;
  if (sweeping() && lastTickAt) {
    const dt = Math.min(now - lastTickAt, 250) / 1000;
    spin += dt * ((Math.PI * 2) / TURN_SECONDS);
    phase = Math.min(phase + dt / CYCLE_SECONDS, END_PHASE);
    if (phase >= END_PHASE) resting = true;
    // Eased at both ends, so it lingers at the base and the top rather than
    // bouncing off them.
    heightKm = lowKm + (highKm - lowKm) * (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  }
  lastTickAt = now;
  const moving = sweeping() || dragging;
  // Capped while it moves; the last frame is always drawn, or a key press
  // landing just after a frame would never show.
  if (!moving || now - lastDrawAt >= 1000 / FPS - 1) {
    render();
    lastDrawAt = now;
  }
  if (moving) frame = requestAnimationFrame(step);
}

/** Draw a frame, and go on drawing for as long as the slice is moving. */
function requestDraw(): void {
  if (frame || !render || !visible) return;
  lastTickAt = 0;
  frame = requestAnimationFrame(step);
}

/** Pause while the canvas is scrolled out of view, and draw again when it is back. */
function watchVisibility(node: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") return undefined;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  });
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}

// A drag or a key moved the slice: one more frame.
$: if (render) {
  void heightKm;
  requestDraw();
}

function onPointerDown(event: PointerEvent): void {
  dragging = true;
  dragFrom = event.clientY;
  dragHeight = heightKm;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  requestDraw();
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  heightKm = clamp(dragHeight - (event.clientY - dragFrom) * DRAG_KM_PER_PX);
}

/** Let go, the slice stays where it was put: that is what the drag was for. */
function onPointerUp(): void {
  if (!dragging) return;
  dragging = false;
  resting = true;
}

function onKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 1 : 0.25;
  if (event.key === "ArrowUp") heightKm = clamp(heightKm + step);
  else if (event.key === "ArrowDown") heightKm = clamp(heightKm - step);
  else return;
  // A reader stepping through by hand wants it to stay where they put it.
  still = true;
  event.preventDefault();
}

onMount(() => {
  still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controller = new AbortController();
  loadCutaway(volume, controller.signal)
    .then(async (loaded) => {
      cutaway = loaded;
      // The canvas is inside `{#if cutaway}`; see CellCutaway for why `tick`.
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

const ratio = typeof devicePixelRatio === "number" ? Math.min(devicePixelRatio, 2) : 1;
$: canvasWidth = Math.max(120, width - RULER_PX);
$: ticks = Array.from({ length: Math.floor(ceilingKm / 2) + 1 }, (_, i) => i * 2)
  .filter((km) => km <= Math.ceil(highKm + 1));
$: rulerTop = Math.min(ceilingKm, Math.ceil(highKm + 1));
/** Where a height sits on the ruler, from its top. */
const at = (km: number, top: number) => `${(1 - km / top) * 100}%`;
</script>

{#if failed}
  <p class="unavailable">Volume unavailable</p>
{:else if cutaway}
  <figure class="cappi">
    <div class="stage" style="height: {height}px">
      <canvas
        bind:this={canvas}
        width={Math.round(canvasWidth * ratio)}
        height={Math.round(height * ratio)}
        style="width: {canvasWidth}px; height: {height}px;"
        use:watchVisibility
        tabindex="0"
        role="slider"
        aria-label="Height of the slice"
        aria-valuemin={Math.round(lowKm * 10) / 10}
        aria-valuemax={Math.round(highKm * 10) / 10}
        aria-valuenow={Math.round(heightKm * 10) / 10}
        aria-valuetext="{heightKm.toFixed(1)} km"
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:keydown={onKey}
      ></canvas>
      <div class="ruler" aria-hidden="true">
        <div class="span" style="top: {at(highKm, rulerTop)}; bottom: calc(100% - {at(lowKm, rulerTop)})"></div>
        {#each ticks as km (km)}
          <span class="tick" style="top: {at(km, rulerTop)}">{km}</span>
        {/each}
        <span class="marker" style="top: {at(heightKm, rulerTop)}">{heightKm.toFixed(1)} km</span>
      </div>
    </div>
    <figcaption>Everything above {heightKm.toFixed(1)} km cut away. Drag up or down to hold a height.</figcaption>
  </figure>
{/if}

<style>
figure { margin: 0; }
/* On the same tinted ground as the panel's structure model, so the two
   pictures read as a pair. */
.stage {
  display: flex; align-items: stretch;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
  overflow: hidden;
}
canvas {
  display: block;
  /* The drag moves the slice, so the page must not read it as a scroll. */
  touch-action: none;
  cursor: ns-resize;
}
canvas:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.ruler {
  position: relative;
  flex: 1 1 auto;
  margin: 10px 0 10px 4px;
  border-left: 1px solid currentColor;
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
}
/* Where the sweep runs: the storm's base to its top. */
.span {
  position: absolute; left: -2px; width: 3px;
  background: currentColor; opacity: 0.25; border-radius: 2px;
}
.tick {
  position: absolute; left: 4px; transform: translateY(-50%);
  opacity: 0.45; line-height: 1;
}
.tick::before {
  content: ""; position: absolute; left: -4px; top: 50%;
  width: 3px; border-top: 1px solid currentColor;
}
.marker {
  position: absolute; left: -5px; transform: translateY(-50%);
  padding: 1px 4px 1px 7px;
  font-weight: 700; line-height: 1.2; white-space: nowrap;
  color: var(--sl-panel-background-color, #fff);
  background: var(--sl-color-neutral-900, #111);
  border-radius: 0 4px 4px 0;
  clip-path: polygon(0 50%, 5px 0, 100% 0, 100% 100%, 5px 100%);
}
figcaption { font-size: 10px; opacity: 0.55; margin-top: 4px; }
.unavailable { font-size: 0.75rem; opacity: 0.6; }
</style>
