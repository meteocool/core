<script lang="ts">
/**
 * The weather along the aircraft's track, as a pilot reads it: the section
 * along the route (lib/studio/flight/routeSection.ts) laid flat, distance
 * ahead across and height up, in the radar's colours. The aircraft stands
 * at its own height near the left edge, with its level drawn across and the
 * way it is climbing or descending drawn ahead of it, so whether it clears a
 * storm's top, and how far off that is, is read off one picture.
 *
 * Drawn when the flight deck says a frame has come
 * (`draw`), and then only if the section or the aircraft's place on it has
 * changed by enough to see.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { dbzColour } from "../../../lib/cellVolume";
import type { Telemetry } from "../../../lib/studio/flight/pilot";
import type { RouteSection } from "../../../lib/studio/flight/routeSection";
import { radarColormap } from "../../../stores";
import { FEET, FONT, INK, prepare } from "./instruments";

const NM = 1852;
/** The weakest echo drawn, and where it is as solid as it gets, dBZ. */
const ECHO_DBZ: [number, number] = [5, 16];
/** How far apart the distances are marked, nautical miles, and the flight levels, hundreds of feet. */
const EVERY_NM = 20;
const EVERY_FL = 100;
/** Room for the flight levels down the right edge, px. */
const SCALE_PX = 34;
/** Drawn again once the aircraft has moved this far up or down, metres, or its path has turned this far, degrees. */
const REDRAW = { altitude: 15, path: 0.15 };

let canvas: HTMLCanvasElement | null = null;
let box: HTMLDivElement | null = null;
let width = 0;
let height = 0;
let observer: ResizeObserver | null = null;
/** The echo of the section last drawn, painted once in its own pixels. */
let echo: HTMLCanvasElement | null = null;
let painted: { section: RouteSection; colormap: string } | null = null;
let drawn: { section: RouteSection; altitude: number; path: number; width: number; height: number } | null = null;

onMount(() => {
  if (!box) return;
  observer = new ResizeObserver(() => {
    width = box?.clientWidth ?? 0;
    height = box?.clientHeight ?? 0;
    drawn = null;
  });
  observer.observe(box);
  width = box.clientWidth;
  height = box.clientHeight;
});

onDestroy(() => observer?.disconnect());

/** The section's echo as a picture, a pixel a sample, the ground's row at the bottom. */
function paintEcho(section: RouteSection, colormap: string): HTMLCanvasElement | null {
  echo ??= document.createElement("canvas");
  echo.width = section.columns;
  echo.height = section.rows;
  const context = echo.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(section.columns, section.rows);
  for (let row = 0; row < section.rows; row += 1) {
    for (let column = 0; column < section.columns; column += 1) {
      const byte = section.echo[row * section.columns + column];
      if (byte === 0) continue;
      const dbz = -32 + (byte / 255) * 96;
      const solid = Math.min(Math.max((dbz - ECHO_DBZ[0]) / (ECHO_DBZ[1] - ECHO_DBZ[0]), 0), 1);
      if (solid <= 0) continue;
      const [r, g, b] = dbzColour(dbz, colormap);
      image.data.set([r, g, b, Math.round(solid * 255)], ((section.rows - 1 - row) * section.columns + column) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  painted = { section, colormap };
  return echo;
}

export function draw(telemetry: Telemetry): void {
  const section = telemetry.section;
  if (!canvas || !section || width <= 0 || height <= 0) return;
  const { altitude, flightPath } = telemetry.state;
  if (drawn && drawn.section === section && drawn.width === width && drawn.height === height
    && Math.abs(drawn.altitude - altitude) < REDRAW.altitude && Math.abs(drawn.path - flightPath) < REDRAW.path) return;
  const context = prepare(canvas, width, height);
  if (!context) return;
  const picture = painted?.section === section && painted.colormap === $radarColormap ? echo : paintEcho(section, $radarColormap);
  paint(context, section, picture, altitude, flightPath);
  drawn = { section, altitude, path: flightPath, width, height };
}

function paint(
  context: CanvasRenderingContext2D, section: RouteSection, picture: HTMLCanvasElement | null, altitude: number, path: number,
): void {
  const across = width - SCALE_PX;
  const x = (alongM: number) => (alongM / section.lengthM) * across;
  const y = (metres: number) => height * (1 - metres / section.topM);
  const from = section.mark?.alongM ?? 0;

  context.save();
  context.beginPath();
  context.rect(0, 0, across, height);
  context.clip();
  if (picture) {
    context.imageSmoothingEnabled = true;
    context.drawImage(picture, 0, 0, across, height);
  }
  // Ruled every so many miles ahead of the aircraft, and at every hundredth flight level.
  context.strokeStyle = "rgba(242, 244, 247, 0.16)";
  context.lineWidth = 1;
  context.beginPath();
  for (let miles = EVERY_NM; from + miles * NM < section.lengthM; miles += EVERY_NM) {
    const at = Math.round(x(from + miles * NM)) + 0.5;
    context.moveTo(at, 0);
    context.lineTo(at, height);
  }
  for (let level = EVERY_FL; (level * 100) / FEET < section.topM; level += EVERY_FL) {
    const at = Math.round(y((level * 100) / FEET)) + 0.5;
    context.moveTo(0, at);
    context.lineTo(across, at);
  }
  context.stroke();

  // The aircraft's level, the length of the strip, and where its path takes it from here.
  const [ax, ay] = [x(from), y(altitude)];
  context.strokeStyle = INK;
  context.lineWidth = 1.25;
  context.setLineDash([6, 5]);
  context.beginPath();
  context.moveTo(ax, Math.round(ay) + 0.5);
  context.lineTo(across, Math.round(ay) + 0.5);
  context.stroke();
  context.setLineDash([]);
  if (Math.abs(path) > 0.3) {
    const ahead = section.lengthM - from;
    context.strokeStyle = "#3ddc84";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(across, y(altitude + Math.tan((path * Math.PI) / 180) * ahead));
    context.stroke();
  }
  context.fillStyle = INK;
  context.beginPath();
  context.moveTo(ax - 9, ay - 5);
  context.lineTo(ax + 5, ay);
  context.lineTo(ax - 9, ay + 5);
  context.closePath();
  context.fill();
  context.restore();

  // What the rules stand for: miles along the bottom, flight levels down the right.
  context.font = `600 10px ${FONT}`;
  context.fillStyle = "rgba(242, 244, 247, 0.78)";
  context.textBaseline = "bottom";
  context.textAlign = "right";
  for (let miles = EVERY_NM; from + miles * NM < section.lengthM; miles += EVERY_NM) {
    context.fillText(`${miles}`, x(from + miles * NM) - 3, height - 2);
  }
  context.textBaseline = "middle";
  context.textAlign = "left";
  for (let level = EVERY_FL; (level * 100) / FEET < section.topM; level += EVERY_FL) {
    context.fillText(`${level}`, across + 5, y((level * 100) / FEET));
  }
  context.textBaseline = "bottom";
  context.fillText("NM", across + 5, height - 2);
}
</script>

<div class="flight-profile" bind:this={box} role="img" aria-label={$_("studio.flight.profile")}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .flight-profile {
    box-sizing: border-box;
    border: 1px solid rgba(242, 244, 247, 0.22);
    border-radius: 8px;
    background: rgba(14, 18, 26, 0.84);
    overflow: hidden;
    pointer-events: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
