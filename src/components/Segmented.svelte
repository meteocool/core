<script lang="ts" generics="T">
/**
 * A segmented control in the Liquid Glass manner: a capsule of options with
 * one glass lens over the chosen one.
 *
 * The lens is one element that moves, not a background each button paints.
 * That is what gives it the system's feel: picking another option sends the
 * lens sliding, and on the way it stretches toward where it is going and
 * then draws back in, settling with the small overshoot of a spring. It can
 * also be dragged -- a finger on the chosen option carries the lens with it,
 * and it snaps to whichever option it is nearest when let go. Everything
 * under the lens is still a button, so a tap on the far option works as it
 * always did and so does a keyboard.
 *
 * The lens is a raised glass: a blurred, saturated fill with the same bevel
 * the trays and pills carry (--mc-glass-highlight), so it reads as part of
 * the same material as the rest of the chrome rather than a white slab.
 */
import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { postToNative } from "../lib/nativeBridge";

/** The options, in order. */
export let options: Array<{ value: T; label: string }> = [];
/** The chosen one. Bindable. */
export let value: T;
/** What the group is, for assistive tech. */
export let label: string;

const dispatch = createEventDispatcher<{ change: T }>();

let group: HTMLDivElement;
let lens: HTMLDivElement;
let buttons: HTMLButtonElement[] = [];

/** Where the lens is: its left edge and width within the group's padding box. */
let left = 0;
let width = 0;
let ready = false;
let dragging = false;
/** While dragging, the option the lens is over, which is drawn as chosen. */
let hovered: T | null = null;
let animation: Animation | null = null;

$: index = Math.max(0, options.findIndex((option) => option.value === value));

function frameOf(i: number): { left: number; width: number } | null {
  const button = buttons[i];
  if (!button) return null;
  return { left: button.offsetLeft, width: button.offsetWidth };
}

function reduced(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Put the lens on the chosen option: instantly, or with the slide. */
function place(animate: boolean): void {
  const to = frameOf(index);
  if (!to || !lens) return;
  animation?.cancel();
  animation = null;
  const from = { left, width };
  left = to.left;
  width = to.width;
  if (!animate || !ready || reduced() || (from.left === to.left && from.width === to.width)) return;
  // The lens stretches to cover the ground between where it was and where it
  // is going, then draws back in on the target and settles with a spring.
  const span = {
    left: Math.min(from.left, to.left),
    right: Math.max(from.left + from.width, to.left + to.width),
  };
  const dx = (x: number) => x - to.left;
  const sx = (w: number) => w / to.width;
  animation = lens.animate([
    { transform: `translateX(${dx(from.left)}px) scaleX(${sx(from.width)})`, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
    { transform: `translateX(${dx(span.left)}px) scaleX(${sx(span.right - span.left)}) scaleY(0.92)`, offset: 0.42, easing: "cubic-bezier(0.22, 1.2, 0.36, 1)" },
    { transform: "translateX(0) scaleX(1) scaleY(1)" },
  ], { duration: 420, fill: "none" });
  animation.onfinish = () => { animation = null; };
}

/** Follow the chosen option, and re-measure when the options change. */
function follow(_index: number, _options: unknown): void {
  if (!ready) return;
  tick().then(() => place(!dragging));
}
$: follow(index, options);

function choose(next: T): void {
  if (next === value) return;
  value = next;
  dispatch("change", next);
  if (dd.isApp()) postToNative("impactLight");
  else navigator.vibrate?.(4);
}

/*
 * Dragging the lens. Only a press that starts on the chosen option carries
 * it; a press anywhere else is a tap on that button and nothing more.
 */
let pointerId: number | null = null;
let downX = 0;
let grab = 0;
let moved = false;

function onPointerDown(event: PointerEvent): void {
  if (!(event.target instanceof HTMLElement)) return;
  const button = event.target.closest("button");
  if (!button || buttons.indexOf(button) !== index) return;
  pointerId = event.pointerId;
  downX = event.clientX;
  grab = event.clientX - group.getBoundingClientRect().left - left;
  moved = false;
}

function nearest(lensLeft: number, lensWidth: number): number {
  const centre = lensLeft + lensWidth / 2;
  let best = index;
  let distance = Infinity;
  buttons.forEach((button, i) => {
    const d = Math.abs(button.offsetLeft + button.offsetWidth / 2 - centre);
    if (d < distance) { distance = d; best = i; }
  });
  return best;
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  if (!moved) {
    if (Math.abs(event.clientX - downX) < 4) return;
    moved = true;
    dragging = true;
    animation?.cancel();
    animation = null;
    try { group.setPointerCapture(event.pointerId); } catch { /* already gone */ }
  }
  const pad = buttons[0]?.offsetLeft ?? 0;
  const lastButton = buttons[buttons.length - 1];
  const max = lastButton ? lastButton.offsetLeft + lastButton.offsetWidth - width : left;
  const x = event.clientX - group.getBoundingClientRect().left - grab;
  left = Math.min(Math.max(x, pad), max);
  const over = options[nearest(left, width)];
  if (over && over.value !== hovered) {
    hovered = over.value;
    if (!dd.isApp()) navigator.vibrate?.(3);
  }
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  pointerId = null;
  if (!moved) return;
  // Let go: the lens goes to the option it is nearest, which becomes chosen.
  const target = nearest(left, width);
  dragging = false;
  hovered = null;
  const option = options[target];
  if (option && option.value !== value) {
    choose(option.value);
  } else {
    place(true);
  }
  // A drag that ends on a button would also click it; the choice is made.
  suppressClick = true;
}

let suppressClick = false;
function onClick(next: T): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  choose(next);
}

function onKey(event: KeyboardEvent): void {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(index + 1, options.length - 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(index - 1, 0);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = options.length - 1;
  else return;
  event.preventDefault();
  choose(options[next].value);
  buttons[next]?.focus();
}

let observer: ResizeObserver | null = null;
onMount(() => {
  ready = true;
  place(false);
  // Labels change width with the language and with fonts arriving late; the
  // lens follows without a slide, which would read as a choice being made.
  observer = new ResizeObserver(() => place(false));
  observer.observe(group);
});
onDestroy(() => {
  observer?.disconnect();
  animation?.cancel();
});
</script>

<style>
  .segmented {
    position: relative;
    display: inline-flex;
    padding: 3px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    /* The lens stands proud of the groove: a shaded inner lip is what makes
       the groove read as recessed. */
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.06);
    isolation: isolate;
    touch-action: pan-y;
    -webkit-tap-highlight-color: transparent;
  }

  /* The lens: raised glass over the chosen option. Positioned by inline
     style; the slide is a Web Animation on transform so the layout never
     changes mid-flight. */
  .lens {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-sheet-card);
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    backdrop-filter: blur(12px) saturate(160%);
    box-shadow: var(--mc-glass-highlight), 0 1px 3px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08);
    transform-origin: left center;
    /* No transition on left or width: they jump to the target and the slide
       is the transform animation, measured from that target. */
    transition: transform var(--mc-motion-fast) var(--mc-ease), box-shadow var(--mc-motion-fast) var(--mc-ease);
    pointer-events: none;
    z-index: 0;
  }
  /* Under a finger the lens is lifted and loosened from the groove. */
  .segmented.dragging .lens {
    transition: none;
    transform: scale(1.04);
    box-shadow: var(--mc-glass-highlight), 0 2px 6px rgba(0, 0, 0, 0.16), 0 6px 16px rgba(0, 0, 0, 0.12);
  }
  /* The specular: a lens is brightest at the rim it turns away from you. */
  .lens::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      radial-gradient(120% 80% at 50% -30%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 60%),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0) 45%);
    pointer-events: none;
  }
  :global([data-theme="dark"]) .lens {
    background: color-mix(in srgb, var(--mc-sheet-card) 85%, #fff 15%);
  }
  :global([data-theme="dark"]) .lens::after {
    background:
      radial-gradient(120% 80% at 50% -30%, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 60%),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 45%);
  }

  button {
    position: relative;
    z-index: 1;
    padding: 5px 12px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: none;
    color: var(--mc-text-2);
    font: 600 12px/1.2 var(--mc-font);
    letter-spacing: -0.01em;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--mc-motion-fast) var(--mc-ease), transform var(--mc-motion-fast) var(--mc-ease);
  }
  button.on {
    color: var(--mc-text);
    cursor: grab;
  }
  .segmented.dragging button { cursor: grabbing; }
  button:not(.on):hover { color: var(--mc-text); }
  /* Pressing the chosen one presses the lens with it. */
  button.on:active { transform: scale(0.97); }
  button:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 1px;
  }
</style>

<div
  class="segmented"
  class:dragging
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  bind:this={group}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  on:keydown={onKey}>
  <div
    class="lens"
    bind:this={lens}
    style:left="{left}px"
    style:width="{width}px"
    style:opacity={ready ? 1 : 0}
    aria-hidden="true"></div>
  {#each options as option, i (option.value)}
    <button
      type="button"
      role="radio"
      class:on={dragging ? hovered === option.value : option.value === value}
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      bind:this={buttons[i]}
      on:click={() => onClick(option.value)}>{option.label}</button>
  {/each}
</div>
