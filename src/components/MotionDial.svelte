<script lang="ts">
/**
 * Which way a storm is going, set by hand: an arrow over a compass, for
 * storm-relative velocity with no storm to take the motion from.
 *
 * The arrow points where a finger is from the dial's centre, so a thumb sets
 * it in one touch, anywhere on the face, and drags it round from there. The
 * finger is followed past the dial's edge too, where the angle is finer than
 * a thumb on the face can be. Five-degree steps, with a tick of haptics on
 * each of the eight named directions; arrow keys turn it a step at a time.
 */
import { createEventDispatcher } from "svelte";
import { haptic } from "../lib/haptics";
import { headingFromPoint, turnHeading } from "../lib/srvMotion";

/** The heading, clockwise from north, that the arrow points along. */
export let heading: number;
/** Whether the motion has any speed: a still one draws its arrow faint. */
export let moving = true;
/** What the dial is, and what its heading reads as, for assistive tech. */
export let label: string;
export let valuetext: string;
/** North's letter, at the top of the face. */
export let north = "N";
/** Across, in CSS pixels. */
export let size = 64;

const dispatch = createEventDispatcher<{ change: number }>();

let dial: HTMLDivElement;
let pointer: number | null = null;

function turnTo(next: number) {
  if (next === heading) return;
  if (next % 45 === 0) haptic("detent");
  dispatch("change", next);
}

function aim(event: PointerEvent) {
  const rect = dial.getBoundingClientRect();
  const next = headingFromPoint(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
  if (next !== null) turnTo(next);
}

function onPointerDown(event: PointerEvent) {
  if (event.button > 0) return;
  // The dial's own: not the start of a swipe for the tray around it, nor a scroll.
  event.stopPropagation();
  event.preventDefault();
  pointer = event.pointerId;
  try { dial.setPointerCapture(event.pointerId); } catch { /* already gone */ }
  dial.focus({ preventScroll: true });
  aim(event);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  event.stopPropagation();
  aim(event);
}

function onPointerUp(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = null;
  try {
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
  } catch { /* already gone */ }
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 9, PageDown: -9 };

function onKey(event: KeyboardEvent) {
  if (event.key === "Home") turnTo(0);
  else if (event.key in STEPS) turnTo(turnHeading(heading, STEPS[event.key]));
  else return;
  event.preventDefault();
}
</script>

<style>
  .dial {
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--mc-tint, rgba(60, 60, 67, 0.08));
    color: var(--mc-text, inherit);
    touch-action: none;
    cursor: grab;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
  }

  .dial.dragging {
    cursor: grabbing;
  }

  .dial:focus-visible {
    outline: 2px solid var(--mc-accent, #007aff);
    outline-offset: 2px;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .tick {
    stroke: color-mix(in srgb, currentColor 35%, transparent);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .tick.cardinal {
    stroke: color-mix(in srgb, currentColor 60%, transparent);
  }

  .north {
    font: 600 13px/1 var(--mc-font);
    fill: var(--mc-text-2, currentColor);
    text-anchor: middle;
    dominant-baseline: central;
  }

  .arrow {
    color: var(--mc-accent, #007aff);
    transition: opacity 120ms;
  }

  .arrow.still {
    opacity: 0.4;
  }

  .arrow line {
    stroke: currentColor;
    stroke-width: 6;
    stroke-linecap: round;
  }

  .arrow path {
    fill: currentColor;
  }
</style>

<div
  bind:this={dial}
  class="dial"
  class:dragging={pointer !== null}
  style:width={`${size}px`}
  style:height={`${size}px`}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={355}
  aria-valuenow={Math.round(heading)}
  aria-valuetext={valuetext}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  on:lostpointercapture={onPointerUp}
  on:keydown={onKey}
>
  <svg viewBox="-50 -50 100 100" aria-hidden="true">
    {#each [0, 45, 90, 135, 180, 225, 270, 315] as deg (deg)}
      {#if deg !== 0}
        <line class="tick" class:cardinal={deg % 90 === 0} y1="-46" y2={deg % 90 === 0 ? -38 : -42} transform="rotate({deg})" />
      {/if}
    {/each}
    <text class="north" y="-37">{north}</text>
    <g class="arrow" class:still={!moving} transform="rotate({heading})">
      <line y1="22" y2="-10" />
      <path d="M0,-26 L-10,-8 L10,-8 Z" />
    </g>
  </svg>
</div>
