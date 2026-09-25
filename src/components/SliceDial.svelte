<script lang="ts">
/**
 * Turning the cut, on a phone, with the storm itself as the picture.
 *
 * On the 3D map the storm a reader opened is already drawn cut, where it
 * stands, at the size of the map -- so the panel's own rendering of it is a
 * second, smaller copy of what is behind the sheet, and it costs half the
 * screen. What the reader still needs from the panel is a way to turn the
 * slice, and that needs no picture: this is a ruler to drag, with the angle
 * under a fixed needle, the way a photo editor's straighten dial works.
 *
 * Why a ruler and not a slider. A slider has ends, and an angle has none: a
 * cut turned past 180 degrees is simply the other half of the storm, so the
 * ruler scrolls round for ever. It also moves under the thumb rather than the
 * thumb moving along it, so the whole width is always grab-able and a flick
 * carries on with momentum, and it settles into the two directions that mean
 * something -- along and across the track, or north-south and east-west for a
 * core with none -- with a tick of haptics where the device has them.
 */
import { onDestroy } from "svelte";
import { cutRotationDeg, cutSweepDeg } from "../stores";
import { stopSweep } from "../lib/cutSweep";
import { cutLabel, cutSnapLabels, normaliseCut } from "../lib/cutAngle";
import { decideAxis, type SwipeAxis } from "../lib/swipeAway";
import type { CutReference } from "../lib/cutAngle";

export let reference: CutReference = "track";

/** Pixels per degree: about 140 degrees across a phone, 5-degree ticks 12px apart. */
const PX_PER_DEG = 2.4;
/** Every this many degrees, a tick; every `MAJOR`, a longer one with a label. */
const MINOR = 5;
const MAJOR = 45;
/** How close to a named direction a released dial has to come to settle on it. */
const DETENT_DEG = 7;
/** Momentum's decay per millisecond: a flick glides about a quarter turn. */
const FRICTION = 0.0045;

let width = 0;
let dragging = false;
let pointerId: number | null = null;
let lastX = 0;
let lastT = 0;
let downX = 0;
let downY = 0;
/**
 * The ruler turns sideways only. A drag that sets off vertically is let go,
 * uncaptured, for the sheet around it to take -- so pulling the sheet down to
 * close works from anywhere on it, the dial included, and the slop-then-commit
 * rule is the one the sheet decides with, so the two never both move.
 */
let axis: SwipeAxis = "undecided";
/** Degrees per millisecond, smoothed over the last few moves of the drag. */
let velocity = 0;
let frame = 0;

/*
 * The dial's own angle is unwrapped -- it can run past 180 -- so the ruler
 * scrolls smoothly through the seam; the store gets it folded. Kept in step
 * with the store when something else turns the cut, such as a link, and with
 * the slow swing an opened storm starts with, which the ruler follows.
 */
$: shown = $cutRotationDeg + $cutSweepDeg;
let angle = $cutRotationDeg;
$: if (!dragging && !frame && Math.abs(normaliseCut(angle - shown)) > 0.01) angle = shown;

$: [alongName, acrossName] = cutSnapLabels(reference);
$: label = cutLabel(shown, reference);

/** The name a major tick carries, if it is one of the two directions that mean something. */
function named(deg: number): string | null {
  const folded = Math.abs(normaliseCut(deg)) % 180;
  if (folded === 0) return alongName;
  if (folded === 90) return acrossName;
  return null;
}

$: ticks = (() => {
  const span = width / 2 / PX_PER_DEG + MINOR;
  const first = Math.ceil((angle - span) / MINOR) * MINOR;
  const out: Array<{ deg: number; x: number; major: boolean; name: string | null }> = [];
  for (let deg = first; deg <= angle + span; deg += MINOR) {
    const major = deg % MAJOR === 0;
    out.push({ deg, x: width / 2 + (deg - angle) * PX_PER_DEG, major, name: major ? named(deg) : null });
  }
  return out;
})();

let lastDetent: number | null = null;

/** Set the angle, telling the map, and give a tick of haptics on crossing a named direction. */
function turnTo(next: number): void {
  angle = next;
  cutRotationDeg.set(normaliseCut(Math.round(next)));
  const detent = Math.round(next / 90);
  if (Math.abs(next - detent * 90) < 1 && detent !== lastDetent) {
    lastDetent = detent;
    navigator.vibrate?.(6);
  } else if (Math.abs(next - (lastDetent ?? 0) * 90) > DETENT_DEG) {
    lastDetent = null;
  }
}

function stop(): void {
  cancelAnimationFrame(frame);
  frame = 0;
}

/** Ease to a resting angle: a named direction if it is close, the nearest degree if not. */
function settle(): void {
  const detent = Math.round(angle / 90) * 90;
  const target = Math.abs(angle - detent) <= DETENT_DEG ? detent : Math.round(angle);
  const from = angle;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - start) / 220, 1);
    turnTo(from + (target - from) * (1 - (1 - t) ** 3));
    frame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}

/** Carry on at the release speed, slowing, then settle. */
function glide(): void {
  if (Math.abs(velocity) < 0.02) {
    settle();
    return;
  }
  let last = performance.now();
  const step = (now: number) => {
    const dt = now - last;
    last = now;
    velocity *= Math.exp(-FRICTION * dt);
    turnTo(angle + velocity * dt);
    if (Math.abs(velocity) < 0.02) {
      frame = 0;
      settle();
    } else {
      frame = requestAnimationFrame(step);
    }
  };
  frame = requestAnimationFrame(step);
}

function onPointerDown(event: PointerEvent): void {
  // Taking hold of the slice stops the swing where it is, rather than
  // letting it carry on under the finger or jump back.
  stopSweep(true);
  stop();
  dragging = true;
  pointerId = event.pointerId;
  downX = lastX = event.clientX;
  downY = event.clientY;
  lastT = event.timeStamp;
  velocity = 0;
  axis = "undecided";
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== pointerId) return;
  if (axis === "undecided") {
    axis = decideAxis(event.clientX - downX, event.clientY - downY);
    if (axis === "undecided") return;
    if (axis === "y") {
      dragging = false;
      pointerId = null;
      settle();
      return;
    }
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* already gone */ }
  }
  // Dragging the ruler left brings the larger angles under the needle, as
  // scrolling content does.
  const delta = -(event.clientX - lastX) / PX_PER_DEG;
  const dt = Math.max(event.timeStamp - lastT, 1);
  velocity = 0.7 * (delta / dt) + 0.3 * velocity;
  lastX = event.clientX;
  lastT = event.timeStamp;
  turnTo(angle + delta);
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  dragging = false;
  pointerId = null;
  // A finger held still before letting go means "here", not "keep going".
  if (event.timeStamp - lastT > 80) velocity = 0;
  glide();
}

function onKey(event: KeyboardEvent): void {
  if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) stopSweep(true);
  const step = event.shiftKey ? 15 : 5;
  if (event.key === "ArrowLeft") turnTo(angle - step);
  else if (event.key === "ArrowRight") turnTo(angle + step);
  else if (event.key === "Home") turnTo(0);
  else return;
  event.preventDefault();
}

function reset(): void {
  stopSweep(true);
  stop();
  const from = angle;
  // To the nearer of the two halves: the cut along the track, from whichever
  // side the reader has turned it to.
  const target = Math.round(from / 180) * 180;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - start) / 320, 1);
    turnTo(from + (target - from) * (1 - (1 - t) ** 3));
    frame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
}

onDestroy(stop);
</script>

<div class="slice">
  <div class="caption">
    <span class="label">{label}</span>
    {#if Math.abs(normaliseCut(shown)) % 180 >= 1}
      <button type="button" class="reset" on:click={reset}>
        {reference === "north" ? "north–south" : "along track"}
      </button>
    {/if}
  </div>
  <div
    class="dial"
    class:dragging
    bind:clientWidth={width}
    role="slider"
    tabindex="0"
    aria-label="Turn the cut"
    aria-valuemin={-180}
    aria-valuemax={180}
    aria-valuenow={Math.round(normaliseCut(shown))}
    aria-valuetext={label}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:keydown={onKey}
  >
    {#each ticks as tick (tick.deg)}
      <span class="tick" class:major={tick.major} class:named={tick.name} style="transform: translateX({tick.x}px)">
        {#if tick.major}
          <span class="deg" class:centred={Math.abs(tick.x - width / 2) < MAJOR * PX_PER_DEG / 4}>
            {tick.name ?? `${Math.abs(normaliseCut(tick.deg))}°`}
          </span>
        {/if}
      </span>
    {/each}
    <span class="needle" aria-hidden="true"></span>
  </div>
</div>

<style>
.slice { display: flex; flex-direction: column; gap: 6px; }
.caption {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 26px;
}
.label { font-size: 0.8rem; font-weight: 600; }
.reset {
  font: inherit; font-size: 0.72rem;
  border: none; border-radius: 999px; padding: 4px 10px;
  background: var(--mc-tint, rgba(60, 60, 67, 0.08)); color: inherit;
  cursor: pointer;
}
.reset:active { background: var(--mc-tint-active, rgba(60, 60, 67, 0.2)); }

.dial {
  position: relative;
  height: 52px;
  border-radius: 12px;
  background: var(--mc-tint, rgba(60, 60, 67, 0.08));
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  outline: none;
  /* The ruler fades out at both ends, so it reads as running on past them. */
  mask-image: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 18%, #000 82%, transparent);
}
.dial.dragging { cursor: grabbing; }
.dial:focus-visible { box-shadow: inset 0 0 0 2px var(--mc-chrome-accent, #007aff); }

.tick {
  position: absolute; left: 0; bottom: 6px;
  width: 1.5px; height: 9px; margin-left: -0.75px;
  border-radius: 1px;
  background: color-mix(in srgb, currentColor 35%, transparent);
  will-change: transform;
}
.tick.major { height: 15px; background: color-mix(in srgb, currentColor 60%, transparent); }
.tick.named { background: color-mix(in srgb, currentColor 85%, transparent); }
/* Above the ticks and clear of the needle, which stands only among the ticks,
   so the direction under it is always legible. */
.deg {
  position: absolute; bottom: 24px; left: 50%;
  transform: translateX(-50%);
  font-size: 0.66rem; font-variant-numeric: tabular-nums; white-space: nowrap;
  opacity: 0.6;
  transition: opacity 120ms, color 120ms;
}
.deg.centred { opacity: 1; font-weight: 600; color: var(--mc-chrome-accent, #007aff); }
.needle {
  position: absolute; bottom: 3px; height: 22px; left: 50%;
  width: 3px; margin-left: -1.5px; border-radius: 2px;
  background: var(--mc-chrome-accent, #007aff);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
}
</style>
