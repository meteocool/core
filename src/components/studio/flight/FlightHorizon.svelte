<script lang="ts">
/**
 * The artificial horizon of a flight seen from outside: from the seat the
 * primary flight display and the standby instrument show which way is up,
 * and outside, with the eye turned round the aircraft, nothing on the view
 * does. A small round one beside the minimap, as the standby's is drawn
 * (panel.ts): sky and ground turned by the bank and moved by the pitch, its
 * ladder every ten degrees, the bank scale fixed over it with the sky
 * pointer turning, the aircraft fixed in the middle.
 *
 * Drawn when the flight deck says a frame has come (`draw`), and then only
 * if the attitude has moved by enough to see.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import type { Telemetry } from "../../../lib/studio/flight/pilot";
import { EARTH, FONT, INK, prepare, SKY } from "./instruments";

const RADIANS = Math.PI / 180;
/** The bank scale's marks, degrees either side; the longer ones at 30 and 60. */
const BANK_MARKS = [0, 10, 20, 30, 45, 60];
/** Drawn again once pitch or bank has moved this far, degrees. */
const REDRAW_DEG = 0.08;

let canvas: HTMLCanvasElement | null = null;
let box: HTMLDivElement | null = null;
let size = 0;
let drawn: { pitch: number; roll: number; size: number } | null = null;
let observer: ResizeObserver | null = null;

onMount(() => {
  if (!box) return;
  observer = new ResizeObserver(() => {
    size = box?.clientWidth ?? 0;
    drawn = null;
  });
  observer.observe(box);
  size = box.clientWidth;
});

onDestroy(() => observer?.disconnect());

export function draw(telemetry: Telemetry): void {
  const { pitch, roll } = telemetry.state;
  if (!canvas || size <= 0) return;
  if (drawn && drawn.size === size && Math.abs(drawn.pitch - pitch) < REDRAW_DEG && Math.abs(wrap(drawn.roll - roll)) < REDRAW_DEG) return;
  const context = prepare(canvas, size, size);
  if (!context) return;
  paint(context, size, pitch, roll);
  drawn = { pitch, roll, size };
}

const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

function paint(context: CanvasRenderingContext2D, side: number, pitch: number, roll: number): void {
  const centre = side / 2;
  const radius = side / 2;
  // Some 40 degrees of pitch across the dial: the ladder reads to twenty either way.
  const perDeg = side / 44;
  context.save();
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.clip();

  // Sky and ground, the ladder with them.
  context.save();
  context.translate(centre, centre);
  context.rotate(-roll * RADIANS);
  const horizon = pitch * perDeg;
  context.fillStyle = SKY;
  context.fillRect(-side, -2 * side + horizon, 2 * side, 2 * side);
  context.fillStyle = EARTH;
  context.fillRect(-side, horizon, 2 * side, 2 * side);
  context.strokeStyle = INK;
  context.fillStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-side, horizon);
  context.lineTo(side, horizon);
  context.stroke();
  context.lineWidth = 1;
  context.font = `700 ${Math.max(8, Math.round(side * 0.075))}px ${FONT}`;
  context.textBaseline = "middle";
  for (let mark = -90; mark <= 90; mark += 5) {
    if (mark === 0) continue;
    const y = (pitch - mark) * perDeg;
    if (Math.abs(y) > radius * 0.8) continue;
    const half = side * (mark % 10 === 0 ? 0.13 : 0.06);
    context.beginPath();
    context.moveTo(-half, y);
    context.lineTo(half, y);
    context.stroke();
    if (mark % 10 === 0) {
      context.textAlign = "right";
      context.fillText(String(Math.abs(mark)), -half - 3, y);
      context.textAlign = "left";
      context.fillText(String(Math.abs(mark)), half + 3, y);
    }
  }
  context.restore();

  // The bank scale, fixed, round the top; the sky pointer turning under it with the horizon.
  const scale = radius * 0.86;
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  for (const mark of BANK_MARKS) {
    for (const side_ of mark === 0 ? [1] : [-1, 1]) {
      const angle = (-90 + side_ * mark) * RADIANS;
      const long = mark === 30 || mark === 60 ? 0.1 : 0.06;
      context.moveTo(centre + Math.cos(angle) * scale, centre + Math.sin(angle) * scale);
      context.lineTo(centre + Math.cos(angle) * scale * (1 + long), centre + Math.sin(angle) * scale * (1 + long));
    }
  }
  context.stroke();
  context.save();
  context.translate(centre, centre);
  context.rotate(-roll * RADIANS);
  context.fillStyle = "#ffd60a";
  context.beginPath();
  context.moveTo(0, -scale + 1);
  context.lineTo(-side * 0.04, -scale + side * 0.07);
  context.lineTo(side * 0.04, -scale + side * 0.07);
  context.closePath();
  context.fill();
  context.restore();

  // The aircraft, fixed: its wings and the dot of its nose.
  context.strokeStyle = "#111";
  context.fillStyle = "#ffd60a";
  context.lineWidth = 1;
  for (const [x, w] of [[-0.3, 0.2], [0.1, 0.2]] as const) {
    context.fillRect(centre + side * x, centre - 2, side * w, 4);
    context.strokeRect(centre + side * x, centre - 2, side * w, 4);
  }
  context.beginPath();
  context.arc(centre, centre, Math.max(2.5, side * 0.025), 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}
</script>

<div class="flight-horizon" role="img" aria-label={$_("studio.flight.horizon")} bind:this={box}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  /* A round instrument, framed as the minimap is; where it stands is the deck's to say. */
  .flight-horizon {
    width: var(--flight-horizon-size, 132px);
    height: var(--flight-horizon-size, 132px);
    border: 1px solid rgba(242, 244, 247, 0.22);
    border-radius: 50%;
    box-sizing: border-box;
    background: rgba(5, 7, 10, 0.74);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    pointer-events: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
