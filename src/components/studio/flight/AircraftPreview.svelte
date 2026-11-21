<script lang="ts">
/**
 * The aircraft by itself, turning slowly: what a flight is planned for,
 * shown before it. Drawn by what draws it in flight
 * (layers/aircraftRenderer.ts), into a canvas of its own.
 *
 * A drag turns it by hand. Still, where the reader asks for less motion.
 */
import { onDestroy, onMount } from "svelte";
import { loadAircraft, makeAircraftRenderer } from "../../../layers/aircraftRenderer";
import type { AircraftRenderer } from "../../../layers/aircraftRenderer";
import { AIRCRAFT_FILES, SUN } from "../../../lib/studio/flight/cockpit";
import { inAircraft, outsideEye } from "../../../lib/studio/flight/view";
import { frameDelta } from "../../../lib/sideways";

/** What the picture is, for a reader who cannot see it. */
export let label: string;

/** A long lens from well back: the aircraft's shape, not its nose. */
const FOV = 24;
const DISTANCE = 96;
/** How fast it turns by itself, degrees a second. */
const TURN = 9;
const LEVEL = { heading: 0, pitch: 0, roll: 0 };

const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let canvas: HTMLCanvasElement | null = null;
let renderer: AircraftRenderer | null = null;
let frame: number | null = null;
let yaw = 140;
let pitch = -9;
let last: number | null = null;
let held = false;
let failed = false;

function draw(now: number): void {
  frame = requestAnimationFrame(draw);
  const gl = canvas?.getContext("webgl2");
  if (!canvas || !gl || !renderer) return;
  if (!held && !still && last !== null) yaw = (yaw + ((now - last) / 1000) * TURN) % 360;
  last = now;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const [width, height] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  renderer.draw({
    modelView: outsideEye(LEVEL, { yaw, pitch }, DISTANCE).modelView,
    fov: FOV,
    light: inAircraft(LEVEL, SUN),
    inside: false,
    veil: 0,
    flash: 0,
    // In flight, as it will be when the flight starts: the gear up.
    gear: 0,
  }, []);
}

function pointerdown(event: PointerEvent): void {
  held = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function pointermove(event: PointerEvent): void {
  if (!held) return;
  // Across the picture as drawn, on its side in the apps (lib/sideways.ts).
  const [dx, dy] = frameDelta(event.movementX, event.movementY);
  yaw = (yaw - dx * 0.5 + 360) % 360;
  pitch = Math.min(60, Math.max(-60, pitch - dy * 0.3));
}

onMount(() => {
  const gl = canvas?.getContext("webgl2", { alpha: true, antialias: true });
  if (!gl) {
    failed = true;
    return;
  }
  const mine = makeAircraftRenderer(gl);
  renderer = mine;
  void loadAircraft(AIRCRAFT_FILES).then(({ model, images }) => {
    if (renderer === mine) mine.upload(model, images);
  }, () => { failed = true; });
  frame = requestAnimationFrame(draw);
});

onDestroy(() => {
  if (frame !== null) cancelAnimationFrame(frame);
  renderer?.dispose();
  renderer = null;
});
</script>

{#if !failed}
  <canvas
    bind:this={canvas}
    class:held
    aria-label={label}
    on:pointerdown={pointerdown}
    on:pointermove={pointermove}
    on:pointerup={() => { held = false; }}
    on:pointercancel={() => { held = false; }}></canvas>
{/if}

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
  }
  canvas.held { cursor: grabbing; }
</style>
